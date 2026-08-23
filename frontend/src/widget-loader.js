// O script que o cliente cola no site dele.
//
// Ele vive em DUAS origens ao mesmo tempo, e confundir as duas era o defeito: o arquivo é
// servido pelo FRONTEND (e o chat abre num iframe de lá), mas a configuração e as
// mensagens vêm do BACKEND, que é outro domínio em produção.
//
// Antes tudo usava a origem do script. Em desenvolvimento funcionava — o Vite faz proxy
// de /api para o backend —, e em produção o nginx do frontend não faz: o loader recebia
// o index.html no lugar do JSON, o `res.json()` estourava, e o widget simplesmente não
// aparecia. Nenhum erro visível no site do cliente, nada no ar.
//
// `__API_ORIGIN__` é substituído no build pelo mesmo `VITE_API_URL` que o resto do app
// usa (ver vite.config.ts). Nada de domínio fixo no fonte.
;(function () {
  var currentScript = document.currentScript
  var publicKey = currentScript && currentScript.getAttribute('data-widget-key')

  if (!publicKey) {
    console.error('[comunicacaoai-widget] missing data-widget-key attribute on the script tag')
    return
  }

  // De onde o CHAT é servido: o iframe continua saindo daqui.
  var frontendOrigin = new URL(currentScript.src).origin

  /**
   * De onde a CONFIGURAÇÃO e as MENSAGENS vêm.
   *
   * Ordem: o que o cliente escreveu em `data-api-url` (escape para instalação fora do
   * padrão), o valor do build, e por último a origem do script — que é o que faz o
   * desenvolvimento continuar funcionando, onde o proxy do Vite resolve /api.
   *
   * O snippet ANTIGO, sem `data-api-url`, cai no valor do build: por isso ele continua
   * funcionando sem o cliente trocar uma linha.
   */
  var apiOrigin = (currentScript.getAttribute('data-api-url') || '__API_ORIGIN__' || frontendOrigin).replace(/\/+$/, '')
  var open = false

  function buildWidget(config) {
    var isLeft = config.position === 'left'
    var color = config.primaryColor || '#111827'
    var sideRule = isLeft ? 'left:20px' : 'right:20px'

    var button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', 'Abrir chat')
    button.style.cssText = [
      'position:fixed',
      'bottom:20px',
      sideRule,
      'z-index:2147483000',
      'width:56px',
      'height:56px',
      'border-radius:9999px',
      'border:none',
      'background:' + color,
      'color:#fff',
      'font:600 12px system-ui,sans-serif',
      'cursor:pointer',
      'box-shadow:0 10px 25px rgba(0,0,0,.25)',
      'padding:0',
      'overflow:hidden',
    ].join(';')

    if (config.avatarUrl) {
      var img = document.createElement('img')
      img.src = config.avatarUrl
      img.alt = ''
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:9999px'
      button.appendChild(img)
    } else {
      button.textContent = 'Chat'
    }

    var iframe = document.createElement('iframe')
    iframe.src = frontendOrigin + '/widget/' + encodeURIComponent(publicKey)
    iframe.title = 'Chat'
    iframe.style.cssText = [
      'position:fixed',
      'bottom:88px',
      sideRule,
      'width:360px',
      'height:520px',
      'max-width:calc(100vw - 40px)',
      'max-height:calc(100vh - 120px)',
      'border:none',
      'border-radius:16px',
      'box-shadow:0 20px 45px rgba(0,0,0,.25)',
      'z-index:2147483000',
      'display:none',
      'background:#0f172a',
    ].join(';')

    function toggle() {
      open = !open
      iframe.style.display = open ? 'block' : 'none'
    }

    button.addEventListener('click', toggle)

    function mount() {
      document.body.appendChild(iframe)
      document.body.appendChild(button)
    }

    if (document.body) {
      mount()
    } else {
      document.addEventListener('DOMContentLoaded', mount)
    }
  }

  fetch(apiOrigin + '/api/public/widgets/' + encodeURIComponent(publicKey))
    .then(function (res) {
      // Configuração indisponível = o widget simplesmente NÃO monta. Nada é desenhado no
      // site do cliente: um botão de chat que abre e não atende é pior que botão nenhum.
      // O motivo fica no console, para quem administra encontrar.
      if (!res.ok) throw new Error('widget indisponível (HTTP ' + res.status + ')')
      return res.json()
    })
    .then(buildWidget)
    .catch(function (err) {
      console.error('[comunicacaoai-widget] failed to load widget config', err)
    })
})()
