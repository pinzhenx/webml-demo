'use strict';
const tfliteModelArray = [
  "mobilenet_v1_tflite",
  "mobilenet_v1_quant_tflite",
  "mobilenet_v2_tflite",
  "mobilenet_v2_quant_tflite",
  "inception_v3_tflite",
  "inception_v4_tflite",
  "squeezenet_tflite",
  "inception_resnet_v2_tflite"];

const ssdModelArray = [
  "ssd_mobilenet_v1_tflite",
  "ssd_mobilenet_v1_quant_tflite",
  "ssd_mobilenet_v2_tflite",
  "ssd_mobilenet_v2_quant_tflite",
  "ssdlite_mobilenet_v2_tflite",
  "tiny_yolov2_coco_tflite",
  "tiny_yolov2_voc_tflite"];

const onnxModelArray = [
  "squeezenet_onnx",
  "mobilenet_v2_onnx",
  "resnet_v1_onnx",
  "resnet_v2_onnx",
  "inception_v2_onnx",
  "densenet_onnx"];

const segmentationModelArray = [
  'deeplab_mobilenet_v2_224_tflite',
  'deeplab_mobilenet_v2_224_atrous_tflite',
  'deeplab_mobilenet_v2_257_tflite',
  'deeplab_mobilenet_v2_257_atrous_tflite',
  'deeplab_mobilenet_v2_321_tflite',
  'deeplab_mobilenet_v2_321_atrous_tflite',
  'deeplab_mobilenet_v2_513_tflite',
  'deeplab_mobilenet_v2_513_atrous_tflite',
  'deeplab_mobilenet_v2_513os16_tflite',
  'deeplab_mobilenet_v2_513os16argmax_tflite',
];

let supportedModels = [];
supportedModels = supportedModels.concat(imageClassificationModels, objectDetectionModels, humanPoseEstimationModels, semanticSegmentationModels);

let imageElement = null;
let inputElement = null;
let pickBtnEelement = null;
let canvasElement = null;
let poseCanvas = null;
let segCanvas = null;
let bkPoseImageSrc = null;
let pnConfigDic = null;

let preferDivElement = document.getElementById('preferDiv');
let preferSelectElement = document.getElementById('preferSelect');

function getModelDicItem(modelFormatName) {
  for (let model of supportedModels) {
    if (model.modelFormatName === modelFormatName) {
      return model;
    }
  }
}

function getPreferString() {
  return preferSelectElement.options[preferSelectElement.selectedIndex].value;
}

function getSelectedOps() {
  return getPreferString() === 'none' ? new Set() : new Set(
    Array.from(
      document.querySelectorAll('input[name=supportedOp]:checked')).map(
        x => parseInt(x.value)));
}

function updateOpsSelect() {
  const backend = JSON.parse(configurations.value).backend;
  const prefer = preferSelect.value;
  if (backend !== 'native' && prefer !== 'none') {
    // hybrid mode
    document.getElementById('supported-ops-select').style.visibility = 'visible';
  } else if (backend === 'WebML' && prefer === 'none') {
    throw new Error('No backend selected');
  } else {
    // solo mode
    document.getElementById('supported-ops-select').style.visibility = 'hidden';
  }
  supportedOps = getSelectedOps();
}

const util = new Utils();
class Logger {
  constructor($dom) {
    this.$dom = $dom;
    this.indent = 0;
  }
  log(message) {
    console.log(message);
    this.$dom.innerHTML += `\n${'\t'.repeat(this.indent) + message}`;
  }
  error(err) {
    console.error(err);
    this.$dom.innerHTML += `\n${'\t'.repeat(this.indent) + err.message}`;
  }
  group(name) {
    console.group(name);
    this.log('');
    this.$dom.innerHTML += `\n${'\t'.repeat(this.indent) + name}`;
    this.indent++;
  }
  groupEnd() {
    console.groupEnd();
    this.indent--;
  }
}
class Benchmark {
  constructor() {
    this.summary = null;
  }
  async runAsync(configuration) {
    this.configuration = configuration;
    await this.setupAsync();
    let results = await this.executeAsync();
    await this.finalizeAsync();
    return {"computeResults": this.summarize(results.computeResults),
            "decodeResults": this.summarize(results.decodeResults),
            "profilingResults": this.summarizeProf(results.profilingResults)};
  }
  /**
   * Setup model
   * @returns {Promise<void>}
   */
  async setupAsync() {
    throw Error("Not Implemented");
  }

  async loadImage(canvas, width, height) {
    let ctx = canvas.getContext('2d');
    let image = new Image();
    let promise = new Promise((resolve, reject) => {
      image.crossOrigin = '';
      image.onload = () => {
        canvas.width = width;
        canvas.height = height;
        canvas.setAttribute("width", width);
        canvas.setAttribute("height", height);
        ctx.drawImage(image, 0, 0, width, height);
        resolve(image);
      };
    });
    image.src = imageElement.src;
    return promise;
  }

  async executeAsync() {
    let computeResults = [];
    let decodeResults = [];
    let modelName = this.configuration.modelName;
    if (tfliteModelArray.indexOf(modelName) !== -1 || onnxModelArray.indexOf(modelName) !== -1) {
      for (let i = 0; i < this.configuration.iteration; i++) {
        this.onExecuteSingle(i);
        await new Promise(resolve => requestAnimationFrame(resolve));
        let tStart = performance.now();
        await this.executeSingleAsync();
        this.deQuantizeParams = this.model._deQuantizeParams;
        let elapsedTime = performance.now() - tStart;
        this.printPredictResult();
        computeResults.push(elapsedTime);
      }
    } else if (modelName === 'posenet') {
      let singlePose = null;
      for (let i = 0; i < this.configuration.iteration; i++) {
        this.onExecuteSingle(i);
        await new Promise(resolve => requestAnimationFrame(resolve));
        let tStart = performance.now();
        await this.executeSingleAsyncPN();
        let elapsedTime = performance.now() - tStart;
        computeResults.push(elapsedTime);
        let dstart = performance.now();
        singlePose = decodeSinglepose(sigmoid(this.heatmapTensor), this.offsetTensor,
                                      toHeatmapsize(this.scaleInputSize, this.outputStride),
                                      this.outputStride);
        let decodeTime = performance.now() - dstart;
        console.log("Decode time:" + decodeTime);
        decodeResults.push(decodeTime);
      }
      // draw canvas by last result
      await this.loadImage(poseCanvas, imageElement.width, imageElement.height);
      let ctx = poseCanvas.getContext('2d');
      let scaleX = poseCanvas.width / this.scaleWidth;
      let scaleY = poseCanvas.height / this.scaleHeight;
      singlePose.forEach((pose) => {
        if (pose.score >= this.minScore) {
          drawKeypoints(pose.keypoints, this.minScore, ctx, scaleX, scaleY);
          drawSkeleton(pose.keypoints, this.minScore, ctx, scaleX, scaleY);
        }
      });
      bkPoseImageSrc = imageElement.src;
      imageElement.src = poseCanvas.toDataURL();
    } else if (ssdModelArray.indexOf(modelName) !== -1) {
      if (this.ssdModelType === 'SSD') {
        let outputBoxTensor, outputClassScoresTensor;
        for (let i = 0; i < this.configuration.iteration; i++) {
          this.onExecuteSingle(i);
          await new Promise(resolve => requestAnimationFrame(resolve));
          let tStart = performance.now();
          await this.executeSingleAsyncSSDMN();
          let elapsedTime = performance.now() - tStart;
          computeResults.push(elapsedTime);
          if (this.isQuantized) {
            [outputBoxTensor, outputClassScoresTensor] = this.deQuantizeOutputTensor(this.outputBoxTensor, this.outputClassScoresTensor, this.model._deQuantizeParams);
          } else {
            outputBoxTensor = this.outputBoxTensor;
            outputClassScoresTensor = this.outputClassScoresTensor;
          }
          let dstart = performance.now();
          decodeOutputBoxTensor({}, outputBoxTensor, this.anchors);
          let decodeTime = performance.now() - dstart;
          console.log("Decode time:" + decodeTime);
          decodeResults.push(decodeTime);
        }
        let [totalDetections, boxesList, scoresList, classesList] = NMS({}, outputBoxTensor, outputClassScoresTensor);
        poseCanvas.setAttribute("width", imageElement.width);
        poseCanvas.setAttribute("height", imageElement.height);
        visualize(poseCanvas, totalDetections, imageElement, boxesList, scoresList, classesList, this.labels);
      } else {
        let decode_out;
        for (let i = 0; i < this.configuration.iteration; i++) {
          this.onExecuteSingle(i);
          await new Promise(resolve => requestAnimationFrame(resolve));
          let tStart = performance.now();
          await this.executeSingleAsyncSSDMN();
          let elapsedTime = performance.now() - tStart;
          computeResults.push(elapsedTime);

          let dstart = performance.now();
          decode_out = decodeYOLOv2({nb_class: this.numClasses}, this.outputTensor[0], this.anchors);
          let decodeTime = performance.now() - dstart;
          console.log("Decode time:" + decodeTime);
          decodeResults.push(decodeTime);
        }
        let boxes = getBoxes(decode_out, this.ssdModelMargin);
        poseCanvas.setAttribute("width", imageElement.width);
        poseCanvas.setAttribute("height", imageElement.height);
        drawBoxes(imageElement, poseCanvas, boxes, this.labels);
      }
      bkPoseImageSrc = imageElement.src;
      imageElement.src = poseCanvas.toDataURL();
    } else if (segmentationModelArray.indexOf(modelName) !== -1) {
      for (let i = 0; i < this.configuration.iteration; i++) {
        this.onExecuteSingle(i);
        await new Promise(resolve => requestAnimationFrame(resolve));
        let tStart = performance.now();
        await this.executeSingleAsync();
        let elapsedTime = performance.now() - tStart;
        computeResults.push(elapsedTime);
      }
      let imWidth = imageElement.naturalWidth;
      let imHeight = imageElement.naturalHeight;
      let resizeRatio = Math.max(Math.max(imWidth, imHeight) / this.inputSize[0], 1);
      let scaledWidth = Math.floor(imWidth / resizeRatio);
      let scaledHeight = Math.floor(imHeight / resizeRatio);
      let renderer = new Renderer(segCanvas);
      renderer.setup();
      renderer.uploadNewTexture(imageElement, [scaledWidth, scaledHeight]);
      renderer.drawOutputs({
        data: this.outputTensor,
        outputShape: this.outputSize,
        labels: this.labels,
      });
      bkPoseImageSrc = imageElement.src;
      imageElement.src = segCanvas.toDataURL();
    }
    const profilingResults = this.model._backend === 'WebML' ?
        null :
        this.model._compilation._preparedModel.dumpProfilingResults();
    return {
      "computeResults": computeResults,
      "decodeResults": decodeResults,
      "profilingResults": profilingResults,
    };
  }
  /**
   * Execute model
   * @returns {Promise<void>}
   */
  async executeSingleAsync() {
    throw Error('Not Implemented');
  }
  /**
   * Execute PoseNet model
   * @returns {Promise<void>}
   */
  async executeSingleAsyncPN() {
    throw Error('Not Implemented');
  }
  /**
   * Execute SSD MobileNet model
   * @returns {Promise<void>}
   */
  async executeSingleAsyncSSDMN() {
    throw Error('Not Implemented');
  }
  /**
   * Finalize
   * @returns {Promise<void>}
   */
  async finalizeAsync() {}
  summarize(results) {
    if (results.length !== 0) {
      results.shift(); // remove first run, which is regarded as "warming up" execution
      let d = results.reduce((d, v) => {
        d.sum += v;
        d.sum2 += v * v;
        return d;
      }, {
        sum: 0,
        sum2: 0
      });
      let mean = d.sum / results.length;
      let std = Math.sqrt((d.sum2 - results.length * mean * mean) / (results.length - 1));
      return {
        configuration: this.configuration,
        mean: mean,
        std: std,
        results: results
      };
    } else {
      return null;
    }
  }
  summarizeProf(results) {
    const lines = [];
    if (!results) {
      return lines;
    }
    lines.push(`Execution calls: ${results.epochs} (omitted ${results.warmUpRuns} warm-up runs)`);
    lines.push(`Supported Ops: ${results.supportedOps.join(', ') || 'None'}`);
    lines.push(`Mode: ${results.mode}`);

    let polyfillTime = 0;
    let webnnTime = 0;
    for (const t of results.timings) {
      lines.push(`${t.elpased.toFixed(8).slice(0, 7)} ms\t- (${t.backend}) ${t.summary}`);
      if (t.backend === 'WebNN') {
        webnnTime += t.elpased;
      } else {
        polyfillTime += t.elpased;
      }
    }
    lines.push(`Polyfill time: ${polyfillTime.toFixed(5)} ms`);
    lines.push(`WebNN time: ${webnnTime.toFixed(5)} ms`);
    lines.push(`Sum: ${(polyfillTime + webnnTime).toFixed(5)} ms`);
    return lines;
  }
  onExecuteSingle(iteration) {}
}
class WebMLJSBenchmark extends Benchmark {
  constructor() {
    super(...arguments);
    this.inputTensor = null;
    // outputTensor only for mobilenet and squeezenet
    this.inputSize = null;
    this.outputTensor = null;
    this.outputSize = null;

    // only for posenet
    this.modelVersion = null;
    this.outputStride = null;
    this.scaleFactor = null;
    this.minScore = null;
    this.scaleWidth = null;
    this.scaleHeight = null;
    this.scaleInputSize = null;
    this.heatmapTensor = null;
    this.offsetTensor  = null;

    //only for ssd mobilenet
    this.outputBoxTensor = null;
    this.outputClassScoresTensor = null;
    this.deQuantizedOutputBoxTensor = null;
    this.deQuantizedOutputClassScoresTensor = null;
    this.deQuantizeParams = null;
    this.anchors = null;
    this.ssdModelType;
    this.ssdModelMargin;
    this.numClasses;

    this.isQuantized = false;

    this.model = null;
    this.labels = null;

  }
  async loadModelAndLabels(model) {
    let url = '../examples/util/';
    let arrayBuffer = await this.loadUrl(url + model.modelFile, true);
    let bytes = new Uint8Array(arrayBuffer);
    let text = await this.loadUrl(url + model.labelsFile);
    return {
      bytes: bytes,
      text: text
    };
  }
  async loadUrl(url, binary) {
    return new Promise((resolve, reject) => {
      let request = new XMLHttpRequest();
      request.open('GET', url, true);
      if (binary) {
        request.responseType = 'arraybuffer';
      }
      request.onload = function (ev) {
        if (request.readyState === 4) {
          if (request.status === 200) {
            resolve(request.response);
          } else {
            reject(new Error('Failed to load ' + url + ' status: ' + request.status));
          }
        }
      };
      request.send();
    });
  }
  async setInputOutput() {
    const configModelName = this.configuration.modelName;
    const currentModel = getModelDicItem(configModelName);

    let width = currentModel.inputSize[1];
    let height = currentModel.inputSize[0];
    let dwidth;
    let dheight;
    const channels = currentModel.inputSize[2];
    const preOptions = currentModel.preOptions || {};
    const mean = preOptions.mean || [0, 0, 0, 0];
    const std  = preOptions.std  || [1, 1, 1, 1];
    const norm = preOptions.norm || false;
    const channelScheme = preOptions.channelScheme || 'RGB';
    const imageChannels = 4; // RGBA
    let drawContent;

    this.isQuantized = currentModel.isQuantized || false;
    let typedArray;

    if (this.isQuantized) {
      typedArray = Uint8Array;
    } else {
      typedArray = Float32Array;
    }

    if (tfliteModelArray.indexOf(configModelName) !== -1 || onnxModelArray.indexOf(configModelName) !== -1) {
      this.inputTensor = new typedArray(currentModel.inputSize.reduce((a, b) => a * b));
      this.outputTensor = new typedArray(currentModel.outputSize);
      drawContent = imageElement;
      dwidth = width;
      dheight = height;
    } else if (ssdModelArray.indexOf(configModelName) !== -1) {
      if (bkPoseImageSrc !== null) {
        // reset for rerun with same image
        imageElement.src = bkPoseImageSrc;
      }
      this.outputTensor = [];
      this.ssdModelType = currentModel.type;
      this.ssdModelMargin = currentModel.margin;
      this.numClasses = currentModel.num_classes;
      if (currentModel.type === 'SSD') {
        if (this.isQuantized) {
          this.deQuantizedOutputBoxTensor = new Float32Array(currentModel.num_boxes * currentModel.box_size);
          this.deQuantizedOutputClassScoresTensor = new Float32Array(currentModel.num_boxes * currentModel.num_classes);
        }
        this.inputTensor = new typedArray(currentModel.inputSize.reduce((a, b) => a * b));
        this.outputBoxTensor = new typedArray(currentModel.num_boxes * currentModel.box_size);
        this.outputClassScoresTensor = new typedArray(currentModel.num_boxes * currentModel.num_classes);
        this.prepareoutputTensor(this.outputBoxTensor, this.outputClassScoresTensor);
        this.anchors = generateAnchors({});
      } else {
        // YOLO
        this.inputTensor = new typedArray(currentModel.inputSize.reduce((a, b) => a * b));
        this.anchors = currentModel.anchors;
        this.outputTensor = [new typedArray(currentModel.outputSize)]
      }
      drawContent = imageElement;
      dwidth = width;
      dheight = height;
    } else if (segmentationModelArray.indexOf(configModelName) !== -1) {
      if (bkPoseImageSrc !== null) {
        // reset for rerun with same image
        imageElement.src = bkPoseImageSrc;
      }
      this.inputTensor = new typedArray(currentModel.inputSize.reduce((a, b) => a * b));
      this.outputTensor = new typedArray(currentModel.outputSize.reduce((a, b) => a * b));
      this.inputSize = currentModel.inputSize;
      this.outputSize = currentModel.outputSize;
      height = this.inputSize[0];
      width = this.inputSize[1];
      let imWidth = imageElement.naturalWidth;
      let imHeight = imageElement.naturalHeight;
      // assume deeplab_out.width == deeplab_out.height
      let resizeRatio = Math.max(Math.max(imWidth, imHeight) / width, 1);
      drawContent = imageElement;
      dwidth = Math.floor(imWidth / resizeRatio);
      dheight = Math.floor(imHeight / resizeRatio);
    } else if (configModelName === 'posenet') {
      if (bkPoseImageSrc !== null) {
        // reset for rerun with same image
        imageElement.src = bkPoseImageSrc;
      }
      if (pnConfigDic === null) {
        // Read modelVersion outputStride scaleFactor minScore from json file
        let posenetConfigURL = './posenetConfig.json';
        let pnConfigText = await this.loadUrl(posenetConfigURL);
        pnConfigDic = JSON.parse(pnConfigText);
      }
      this.modelVersion = Number(pnConfigDic.modelVersion);
      this.outputStride = Number(pnConfigDic.outputStride);
      this.scaleFactor = Number(pnConfigDic.scaleFactor);
      this.minScore = Number(pnConfigDic.minScore);

      this.scaleWidth = getValidResolution(this.scaleFactor, width, this.outputStride);
      this.scaleHeight = getValidResolution(this.scaleFactor, height, this.outputStride);
      this.inputTensor = new typedArray(this.scaleWidth * this.scaleHeight * channels);
      this.scaleInputSize = [1, this.scaleWidth, this.scaleHeight, channels];

      let HEATMAP_TENSOR_SIZE;
      if ((this.modelVersion == 0.75 || this.modelVersion == 0.5) && this.outputStride == 32) {
        HEATMAP_TENSOR_SIZE = product(toHeatmapsize(this.scaleInputSize, 16));
      } else {
        HEATMAP_TENSOR_SIZE = product(toHeatmapsize(this.scaleInputSize, this.outputStride));
      }
      let OFFSET_TENSOR_SIZE = HEATMAP_TENSOR_SIZE * 2;
      this.heatmapTensor = new typedArray(HEATMAP_TENSOR_SIZE);
      this.offsetTensor = new typedArray(OFFSET_TENSOR_SIZE);
      // prepare canvas for predict
      let poseCanvasPredict = document.getElementById('poseCanvasPredict');
      drawContent = await this.loadImage(poseCanvasPredict, width, height);
      width = this.scaleWidth;
      height = this.scaleHeight;
      dwidth = width;
      dheight = height;
    }

    canvasElement.setAttribute("width", width);
    canvasElement.setAttribute("height", height);
    let canvasContext = canvasElement.getContext('2d');
    canvasContext.drawImage(drawContent, 0, 0, dwidth, dheight);
    let pixels = canvasContext.getImageData(0, 0, width, height).data;
    if (norm) {
      pixels = new Float32Array(pixels).map(p => p / 255);
    }

    if (channelScheme === 'RGB') {
      // NHWC layout
      for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
          for (let c = 0; c < channels; ++c) {
            let value = pixels[y * width * imageChannels + x * imageChannels + c];
            this.inputTensor[y * width * channels + x * channels + c] = (value - mean[c]) / std[c];
          }
        }
      }
    } else if (channelScheme === 'BGR') {
      // NHWC layout
      for (let y = 0; y < height; ++y) {
        for (let x = 0; x < width; ++x) {
          for (let c = 0; c < channels; ++c) {
            let value = pixels[y * width * imageChannels + x * imageChannels + (channels - c - 1)];
            this.inputTensor[y * width * channels + x * channels + c] = (value - mean[c]) / std[c];
          }
        }
      }
    } else {
      throw new Error(`Unknown color channel scheme ${channelScheme}`);
    }
  }

  prepareoutputTensor(outputBoxTensor, outputClassScoresTensor) {
    const outH = [1083, 600, 150, 54, 24, 6];
    const boxLen = 4;
    const classLen = 91;
    let boxOffset = 0;
    let classOffset = 0;
    let boxTensor;
    let classTensor;
    for (let i = 0; i < 6; ++i) {
      boxTensor = outputBoxTensor.subarray(boxOffset, boxOffset + boxLen * outH[i]);
      classTensor = outputClassScoresTensor.subarray(classOffset, classOffset + classLen * outH[i]);
      this.outputTensor[2 * i] = boxTensor;
      this.outputTensor[2 * i + 1] = classTensor;
      boxOffset += boxLen * outH[i];
      classOffset += classLen * outH[i];
    }
  }

  deQuantizeOutputTensor(outputBoxTensor, outputClassScoresTensor, quantizedParams) {
    const outH = [1083, 600, 150, 54, 24, 6];
    const boxLen = 4;
    const classLen = 91;
    let boxOffset = 0;
    let classOffset = 0;
    let boxTensor, classTensor;
    let boxScale, boxZeroPoint, classScale, classZeroPoint;
    let dqBoxOffset = 0;
    let dqClassOffset = 0;
    for (let i = 0; i < 6; ++i) {
      boxTensor = outputBoxTensor.subarray(boxOffset, boxOffset + boxLen * outH[i]);
      classTensor = outputClassScoresTensor.subarray(classOffset, classOffset + classLen * outH[i]);
      boxScale = quantizedParams[2 * i].scale;
      boxZeroPoint = quantizedParams[2 * i].zeroPoint;
      classScale = quantizedParams[2 * i + 1].scale;
      classZeroPoint = quantizedParams[2 * i + 1].zeroPoint;
      for (let j = 0; j < boxTensor.length; ++j) {
        this.deQuantizedOutputBoxTensor[dqBoxOffset] = boxScale* (boxTensor[j] - boxZeroPoint);
        ++dqBoxOffset;
      }
      for (let j = 0; j < classTensor.length; ++j) {
        this.deQuantizedOutputClassScoresTensor[dqClassOffset] = classScale * (classTensor[j] - classZeroPoint);
        ++dqClassOffset;
      }
      boxOffset += boxLen * outH[i];
      classOffset += classLen * outH[i];
    }
    return [this.deQuantizedOutputBoxTensor, this.deQuantizedOutputClassScoresTensor];
  }

  async setupAsync() {
    await this.setInputOutput();
    let backend = this.configuration.backend.replace('native', 'WebML');
    let modelName = this.configuration.modelName;
    if (tfliteModelArray.indexOf(modelName) !== -1) {
      let model = getModelDicItem(modelName);
      let resultTflite = await this.loadModelAndLabels(model);
      this.labels = resultTflite.text.split('\n');
      let flatBuffer = new flatbuffers.ByteBuffer(resultTflite.bytes);
      let rawModel = tflite.Model.getRootAsModel(flatBuffer);
      let postOptions = model.postOptions || {};
      let kwargs = {
        rawModel: rawModel,
        backend: backend,
        prefer: getPreferString(),
        softmax: postOptions.softmax || false,
      };
      this.model = new TFliteModelImporter(kwargs);
    } else if (onnxModelArray.indexOf(modelName) !== -1) {
      let model = getModelDicItem(modelName);
      let resultONNX = await this.loadModelAndLabels(model);
      this.labels = resultONNX.text.split('\n');
      console.log(`labels: ${this.labels}`);
      let err = onnx.ModelProto.verify(resultONNX.bytes);
      if (err) {
        throw new Error(`Invalid model ${err}`);
      }
      let rawModel = onnx.ModelProto.decode(resultONNX.bytes);
      let postOptions = model.postOptions || {};
      let kwargs = {
        rawModel: rawModel,
        backend: backend,
        prefer: getPreferString(),
        softmax: postOptions.softmax || false,
      };
      this.model = new OnnxModelImporter(kwargs);
    } else if (ssdModelArray.indexOf(modelName) !== -1) {
      let model = getModelDicItem(modelName);
      let resultTflite = await this.loadModelAndLabels(model);
      this.labels = resultTflite.text.split('\n');
      let flatBuffer = new flatbuffers.ByteBuffer(resultTflite.bytes);
      let rawModel = tflite.Model.getRootAsModel(flatBuffer);
      let kwargs = {
        rawModel: rawModel,
        backend: backend,
        prefer: getPreferString(),
      };
      this.model = new TFliteModelImporter(kwargs);
    } else if (modelName === 'posenet') {
      let modelArch = ModelArch.get(this.modelVersion);
      let smType = 'Singleperson';
      let cacheMap = new Map();
      let useAtrousConv = false; // Default false, NNAPI and BNNS don't support AtrousConv
      this.model = new PoseNet(modelArch, this.modelVersion, useAtrousConv, this.outputStride,
                               this.scaleInputSize, smType, cacheMap, backend, getPreferString());
    } else if (segmentationModelArray.indexOf(modelName) !== -1) {
      let model = getModelDicItem(modelName);
      let resultTflite = await this.loadModelAndLabels(model);
      this.labels = resultTflite.text.split('\n');
      let flatBuffer = new flatbuffers.ByteBuffer(resultTflite.bytes);
      let rawModel = tflite.Model.getRootAsModel(flatBuffer);
      let kwargs = {
        rawModel: rawModel,
        backend: backend,
        prefer: getPreferString(),
      };
      this.model = new TFliteModelImporter(kwargs);
    }
    supportedOps =  getSelectedOps();
    await this.model.createCompiledModel();
  }
  printPredictResult() {
    let probs = Array.from(this.outputTensor);
    let indexes = probs.map((prob, index) => [prob, index]);
    let sorted = indexes.sort((a, b) => {
      if (a[0] === b[0]) {
        return 0;
      }
      return a[0] < b[0] ? -1 : 1;
    });
    sorted.reverse();
    let prob;
    for (let i = 0; i < 3; ++i) {
      if (this.isQuantized) {
        prob = this.deQuantizeParams[0].scale * (sorted[i][0] - this.deQuantizeParams[0].zeroPoint);
      } else {
        prob = sorted[i][0];
      }
      let index = sorted[i][1];
      console.log(`label: ${this.labels[index]}, probability: ${(prob * 100).toFixed(2)}%`);
    }
  }
  async executeSingleAsync() {
    let result;
    result = await this.model.compute([this.inputTensor], [this.outputTensor]);
    console.log(`compute result: ${result}`);
  }
  async executeSingleAsyncSSDMN() {
    let result;
    result = await this.model.compute([this.inputTensor], this.outputTensor);
    console.log(`compute result: ${result}`);
  }
  async executeSingleAsyncPN() {
    let result;
    result = await this.model.computeSinglePose(this.inputTensor, this.heatmapTensor, this.offsetTensor);
    console.log(`compute result: ${result}`);
  }
  async finalizeAsync() {
    this.inputTensor = null;
    this.outputTensor = null;
    this.modelVersion = null;
    this.outputStride = null;
    this.scaleFactor = null;
    this.minScore = null;
    this.scaleWidth = null;
    this.scaleHeight = null;
    this.scaleInputSize = null;
    this.heatmapTensor = null;
    this.offsetTensor  = null;
    this.outputBoxTensor = null;
    this.outputClassScoresTensor = null;
    this.deQuantizedOutputBoxTensor = null;
    this.deQuantizedOutputClassScoresTensor = null;
    this.deQuantizeParams = null;
    this.anchors = null;
    this.model = null;
    this.labels = null;
    inputElement.removeAttribute('disabled');
    pickBtnEelement.setAttribute('class', 'btn btn-primary');
  }
}
//---------------------------------------------------------------------------------------------------
//
// Main
//
const BenchmarkClass = {
  'webml-polyfill.js': WebMLJSBenchmark,
  'WebML API': WebMLJSBenchmark
};
async function run() {
  inputElement.setAttribute('class', 'disabled');
  pickBtnEelement.setAttribute('class', 'btn btn-primary disabled');
  let logger = new Logger(document.querySelector('#log'));
  logger.group('Benchmark');
  try {
    let configuration = JSON.parse(document.querySelector('#configurations').selectedOptions[0].value);
    configuration.modelName = document.querySelector('#modelName').selectedOptions[0].value;
    configuration.iteration = Number(document.querySelector('#iteration').value) + 1;
    logger.group('Environment Information');
    logger.log(`${'UserAgent'.padStart(12)}: ${(navigator.userAgent) || '(N/A)'}`);
    logger.log(`${'Platform'.padStart(12)}: ${(navigator.platform || '(N/A)')}`);
    logger.groupEnd();
    logger.group('Configuration');
    Object.keys(configuration).forEach(key => {
      if (key === 'backend') {
        let selectedOpt = preferSelectElement.options[preferSelectElement.selectedIndex];
        let backendName = configuration[key];
        if (configuration[key].indexOf('native') < 0) {
          if (getPreferString() !== 'none') {
            backendName += ` + ${getNativeAPI(selectedOpt.value)}(${selectedOpt.text})`;
          }
        } else {
          backendName = `${getNativeAPI(selectedOpt.value)}(${selectedOpt.text})`;
        }
        logger.log(`${key.padStart(12)}: ${backendName}`);
      } else if (key === 'modelName') {
        let model = getModelDicItem(configuration[key]);
        logger.log(`${key.padStart(12)}: ${model.modelName}`);
      } else {
        logger.log(`${key.padStart(12)}: ${configuration[key]}`);
      }
    });
    logger.groupEnd();
    logger.group('Run');
    let benchmark = new BenchmarkClass[configuration.framework]();
    benchmark.onExecuteSingle = (i => logger.log(`Iteration: ${i + 1} / ${configuration.iteration}`));
    let summary = await benchmark.runAsync(configuration);
    logger.groupEnd();
    if (summary.profilingResults.length) {
      logger.group('Profiling');
      summary.profilingResults.forEach((line) => logger.log(line));
      logger.groupEnd();
    }
    logger.group('Result');
    logger.log(`Inference Time: <em style="color:green;font-weight:bolder;">${summary.computeResults.mean.toFixed(2)}+-${summary.computeResults.std.toFixed(2)}</em> [ms]`);
    if (summary.decodeResults !== null) {
      logger.log(`Decode Time: <em style="color:green;font-weight:bolder;">${summary.decodeResults.mean.toFixed(2)}+-${summary.decodeResults.std.toFixed(2)}</em> [ms]`);
    }
    logger.groupEnd();
  } catch (err) {
    logger.error(err);
  }
  logger.groupEnd();
}
document.addEventListener('DOMContentLoaded', () => {
  inputElement = document.getElementById('input');
  pickBtnEelement = document.getElementById('pickButton');
  imageElement = document.getElementById('image');
  canvasElement = document.getElementById('canvas');
  poseCanvas = document.getElementById('poseCanvas');
  segCanvas = document.getElementById('segCanvas');
  inputElement.addEventListener('change', (e) => {
    $('.labels-wrapper').empty();
    let files = e.target.files;
    if (files.length > 0) {
      imageElement.src = URL.createObjectURL(files[0]);
      bkPoseImageSrc = imageElement.src;
    }
  }, false);

  let modelElement = document.getElementById('modelName');
  modelElement.addEventListener('change', (e) => {
    $('.labels-wrapper').empty();
    bkPoseImageSrc = null;
    let modelName = modelElement.options[modelElement.selectedIndex].value;
    let inputFile = document.getElementById('input').files[0];
    if (inputFile !== undefined) {
      imageElement.src = URL.createObjectURL(inputFile);
    } else {
      if (modelName === 'posenet') {
        imageElement.src = document.getElementById('poseImage').src;
      } else if (ssdModelArray.indexOf(modelName) !== -1) {
        imageElement.src = document.getElementById('ssdMobileImage').src;
      } else if (segmentationModelArray.indexOf(modelName) !== -1) {
        imageElement.src = document.getElementById('segmentationImage').src;
      } else {
        imageElement.src = document.getElementById('imageClassificationImage').src;
      }
    }
  }, false);

  let configurationsElement = document.getElementById('configurations');
  configurationsElement.addEventListener('change', (e) => {
    $('.labels-wrapper').empty();
    bkPoseImageSrc = null;
    let modelName = modelElement.options[modelElement.selectedIndex].value;
    let inputFile = document.getElementById('input').files[0];
    if (inputFile !== undefined) {
      imageElement.src = URL.createObjectURL(inputFile);
    } else {
      if (modelName === 'posenet') {
        imageElement.src = document.getElementById('poseImage').src;
      } else if (ssdModelArray.indexOf(modelName) !== -1) {
        imageElement.src = document.getElementById('ssdMobileImage').src;
      } else if (segmentationModelArray.indexOf(modelName) !== -1) {
        imageElement.src = document.getElementById('segmentationImage').src;
      } else {
        imageElement.src = document.getElementById('imageClassificationImage').src;
      }
    }

    if (currentOS === 'Mac OS') {
      for (var i=0; i<preferSelectElement.options.length; i++) {
        let preferOpt = preferSelectElement.options[i];
        if (preferOpt.value === 'low') {
          preferOpt.disabled = true;
        }
      }
    } else if (['Windows', 'Linux'].indexOf(currentOS) !== -1) {
      for (var i=0; i<preferSelectElement.options.length; i++) {
        let preferOpt = preferSelectElement.options[i];
        if (preferOpt.value === 'sustained') {
          preferOpt.selected = true;
        } else if (preferOpt.value === 'low') {
          preferOpt.disabled = true;
        }
      }
    }
    if (JSON.parse(e.target.value).framework === 'WebML API') {
      document.querySelector('#preferSelect option[value=none]').disabled = true;
    } else {
      document.querySelector('#preferSelect option[value=none]').disabled = false;
    }
    updateOpsSelect();
  }, false);

  let selectAllOpsElement = document.getElementById('selectAllOps');
  selectAllOpsElement.addEventListener('click', () => {
    document.querySelectorAll('input[name=supportedOp]').forEach((x) => {
      x.checked = true;
    });
  }, false);

  let uncheckAllOpsElement = document.getElementById('uncheckAllOps');
  uncheckAllOpsElement.addEventListener('click', () => {
    document.querySelectorAll('input[name=supportedOp]').forEach((x) => {
      x.checked = false;
    });
  }, false);

  let eagerModeElement = document.getElementById('eagerMode');
  eagerModeElement.addEventListener('change', (e) => {
    eager = e.target.checked;
  }, false);

  let preferSelectElement = document.getElementById('preferSelect');
  preferSelectElement.addEventListener('change', () => {
    updateOpsSelect();
  }, false);

  let webmljsConfigurations = [{
    framework: 'webml-polyfill.js',
    backend: 'WASM',
    modelName: '',
    iteration: 0
  },
  {
    framework: 'webml-polyfill.js',
    backend: 'WebGL',
    modelName: '',
    iteration: 0
  }];
  let webmlAPIConfigurations = [{
    framework: 'WebML API',
    backend: 'native',
    modelName: '',
    iteration: 0
  }];
  let configurations = [];
  configurations = configurations.concat(webmljsConfigurations, webmlAPIConfigurations);
  for (let configuration of configurations) {
    let option = document.createElement('option');
    option.value = JSON.stringify(configuration);
    option.textContent = `${configuration.framework} (${configuration.backend} backend)`;
    if (['Android', 'Windows', 'Linux'].indexOf(currentOS) !== -1) {
      for (var i=0; i<preferSelectElement.options.length; i++) {
        let preferOp = preferSelectElement.options[i];
        if (preferOp.text === 'sustained') {
          preferOp.selected = true;
        } else if (preferOp.text === 'fast') {
          preferOp.disabled = true;
        }
      }
    }
    document.querySelector('#configurations').appendChild(option);
  }
  let button = document.querySelector('#runButton');
  button.setAttribute('class', 'btn btn-primary');
  button.addEventListener('click', run);
});
