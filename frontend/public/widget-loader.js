;(function () {
  var currentScript = document.currentScript
  var publicKey = currentScript && currentScript.getAttribute('data-widget-key')

  if (!publicKey) {
    console.error('[comunicacaoai-widget] missing data-widget-key attribute on the script tag')
    return
  }

  var origin = new URL(currentScript.src).origin
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
    iframe.src = origin + '/widget/' + encodeURIComponent(publicKey)
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

  fetch(origin + '/api/public/widgets/' + encodeURIComponent(publicKey))
    .then(function (res) {
      if (!res.ok) throw new Error('widget not found')
      return res.json()
    })
    .then(buildWidget)
    .catch(function (err) {
      console.error('[comunicacaoai-widget] failed to load widget config', err)
    })
})()
