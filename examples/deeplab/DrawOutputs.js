let pproc = new Worker('PostProcessor.js');
let _handlerMap = {};
let registerHandler = (fn, cb) => _handlerMap[fn] = cb;
pproc.onmessage = (e) => _handlerMap[e.data.fn](...e.data.ret);

function drawSegMap(canvas, segMap) {
  let outputWidth = segMap.outputShape[0];
  let outputHeight = segMap.outputShape[1];
  let scaledWidth = segMap.scaledShape[0];
  let scaledHeight = segMap.scaledShape[1];

  pproc.postMessage({
    fn: 'colorizeAndGetLabel',
    args: [segMap]
  }, [
    // transfer outputTensor to worker
    segMap.data.buffer
  ]);

  let ctx = canvas.getContext('2d');
  let imgData = ctx.getImageData(0, 0, outputWidth, outputHeight);

  registerHandler('colorizeAndGetLabel', function(colorSegMap, labelMap) {
    imgData.data.set(colorSegMap);
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;
    ctx.putImageData(imgData, 0, 0, 0, 0, scaledWidth, scaledHeight);
    showLegends(labelMap);
  });
}

function showLegends(labelMap) {
  $('.labels-wrapper').empty();
  for (let id in labelMap) {
    let labelDiv =
      $(`<div class="col-12 seg-label" data-label-id="${id}"/>`)
      .append($(`<span style="color:rgb(${labelMap[id][1]})">⬤</span>`))
      .append(`${labelMap[id][0]}`);
    $('.labels-wrapper').append(labelDiv);
  }
}

function highlightHoverLabel(hoverPos) {
  if (hoverPos === null) {
    // clear highlight when mouse leaving canvas
    $('.seg-label').removeClass('highlight');
    return;
  }

  pproc.postMessage({
    fn: 'getHoverLabelId',
    args: [hoverPos]
  });

  registerHandler('getHoverLabelId', function(id) {
    $('.seg-label').removeClass('highlight');
    $('.labels-wrapper').find(`[data-label-id="${id}"]`).addClass('highlight');
  });
}