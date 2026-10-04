// 这是一个自定义渲染器的样板，默认不启用。
// 启用方法：在 config.json 的 rendererScripts 里加上 "renderers/example-blink.js"
// 然后某个表情写成 { "type": "blink", "src": "assets/calm.png", "eyesClosed": "assets/calm_closed.png" }
//
// 它做的事：平时显示 src，每隔几秒把 eyesClosed 闪一下，模拟眨眼。
// 以后接 Live2D 也是同样的套路：registerRenderer('live2d', (layer, spec) => { 在 layer 里建 canvas，加载模型，返回 destroy })

window.NekoPet.registerRenderer('blink', (layer, spec) => {
  const open = new Image(); open.src = spec.src; open.draggable = false
  const shut = new Image(); shut.src = spec.eyesClosed; shut.draggable = false
  shut.style.visibility = 'hidden'
  layer.appendChild(open); layer.appendChild(shut)

  let timer
  const schedule = () => {
    timer = setTimeout(() => {
      shut.style.visibility = 'visible'
      setTimeout(() => { shut.style.visibility = 'hidden'; schedule() }, 140)
    }, 2500 + Math.random() * 3000)
  }
  schedule()

  return {
    ready: open.decode().catch(() => {}),
    destroy() { clearTimeout(timer) },
  }
})
