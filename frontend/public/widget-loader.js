;(function () {
  var currentScript = document.currentScript
  var publicKey = currentScript && currentScript.getAttribute('data-widget-key')

  if (!publicKey) {
    console.error('[comunicacaoai-widget] missing data-widget-key attribute on the script tag')
    return
  }

  var origin = new URL(currentScript.src).origin
  var open = false

  var button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('aria-label', 'Abrir chat')
  button.textContent = 'Chat'
  button.style.cssText = [
    'position:fixed',
    'bottom:20px',
    'right:20px',
    'z-index:2147483000',
    'width:56px',
    'height:56px',
    'border-radius:9999px',
    'border:none',
    'background:#111827',
    'color:#fff',
    'font:600 12px system-ui,sans-serif',
    'cursor:pointer',
    'box-shadow:0 10px 25px rgba(0,0,0,.25)',
  ].join(';')

  var iframe = document.createElement('iframe')
  iframe.src = origin + '/widget/' + encodeURIComponent(publicKey)
  iframe.title = 'Chat'
  iframe.style.cssText = [
    'position:fixed',
    'bottom:88px',
    'right:20px',
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
})()
