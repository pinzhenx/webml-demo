class Renderer {
  constructor(canvas) {

    this._gl = canvas.getContext('webgl2');
    if (this._gl === null) {
      throw new Error('Unable to initialize WebGL.');
    }

    this._guidedFilter = new GuidedFilter(this._gl);
    this.utils = new WebGLUtils(this._gl);

    this.shaders = {};

    this._segMap = null;
    this._predictions = null;
    this._clippedSize = [224, 224];
    this._imageSource = null;

    this._effect = 'blur';
    this._zoom = 3;
    this._bgColor = [57, 135, 189]; // rgb
    this._colorMapAlpha = 0.7;
    this._blurRadius = 30;
    let kernel1D = this._generateGaussianKernel1D(this._blurRadius * 2 + 1);
    this._halfKernel = kernel1D.slice(this._blurRadius); // take the second half
    this._guidedFilterRadius = 16;

    this._correctionFactor = 0.99;

    this._colorPalette = new Uint8Array([
      45, 52, 54,
      85, 239, 196,
      129, 236, 236,
      116, 185, 255,
      162, 155, 254,
      223, 230, 233,
      0, 184, 148,
      0, 206, 201,
      9, 132, 227,
      39, 60, 117,
      108, 92, 231,
      178, 190, 195,
      255, 234, 167,
      250, 177, 160,
      255, 118, 117,
      253, 121, 168,
      99, 110, 114,
      253, 203, 110,
      225, 112, 85,
      214, 48, 49,
      232, 67, 147,
    ]);
  }

  get zoom() {
    return this._zoom;
  }

  set zoom(val) {
    this._zoom = val;

    // all FRAMEBUFFERs should be re-setup when zooming
    this.setup().then(_ => this.drawOutputs(this._segMap));
  }

  get bgColor() {
    return this._bgColor;
  }

  set bgColor(rgb) {
    this._bgColor = rgb;
    this.drawOutputs();
  }

  get blurRadius() {
    return this._blurRadius;
  }

  set blurRadius(radius) {
    if (this._blurRadius === radius)
      return;

    this._blurRadius = radius;
    let kernelSize = radius * 2 + 1;
    let kernel1D = this._generateGaussianKernel1D(kernelSize, 25);
    // take the second half
    this._halfKernel = kernel1D.slice(radius);

    // re-setup shader with new kernel
    this.setup().then(_ => this.drawOutputs());
  }

  get colorMapAlpha() {
    return this._colorMapAlpha;
  }

  set colorMapAlpha(alpha) {
    this._colorMapAlpha = alpha;

    this._drawColorLabel();
  }

  get effect() {
    return this._effect;
  }

  set effect(val) {
    this._effect = val;

    // shaders need to be rewired when changing effect
    this.setup().then(_ => this.drawOutputs(this._segMap));
  }

  get refineEdgeRadius() {
    return this._guidedFilterRadius;
  }

  set refineEdgeRadius(radius) {
    this._guidedFilterRadius = radius;

    this._guidedFilter.setup(
      this._guidedFilterRadius,
      0.000001,
      this._clippedSize[0] * this._zoom,
      this._clippedSize[1] * this._zoom
    );
    this.drawOutputs(this._segMap);
  }

  async setup() {

    //
    // I. Display color labels
    //                                              
    // +------+                                    ============  +---------+       
    // |  im  |--.                                 |  Shader  |  | Texture |      
    // +------+  |  ============  +-----+          ============  +---------+   
    //           |->| colorize |->| out |           
    // +------+  |  |  Shader  |  +-----+                    
    // | pred |--'  ============
    // +------+                 
    //
    //
    // II. Person segmentation
    //
    // +------+                     +----+
    // |  im  |--.               .->| fg |----------------------------.
    // +------+  |  ===========  |  +----+                            |  =========  +-----+
    //           |->| extract |--|                                    |->| blend |->| out |
    // +------+  |  ===========  |  +----+  ========                  |  =========  +-----+
    // | pred |--'               '->| bg |->| blur |->|\   +--------+ |
    // +------+                     +----+  ========  | |  | styled | |
    //                                                | |->|   Bg   |-'
    //                                      ========  | |  +--------+
    //                                      | fill |->|/
    //                                      ========
    //           _____________________________________________
    //          | two-pass Gaussian blur                      |
    //          |                                             |
    // +----+   |  ==========    +------------+   ==========  |    +----------+
    // | bg |---|->|  blur  |--> | blurFirst  |-->|  blur  |--|--> | styledBg |
    // +----+   |  | Shader |    | PassResult |   | Shader |  |    +----------+   
    //          |  ==========    +------------+   ==========  |
    //          |_____________________________________________|
    //

    this._guidedFilter.setup(
      this._guidedFilterRadius,
      1e-6,
      this._clippedSize[0] * this._zoom,
      this._clippedSize[1] * this._zoom
    );

    this.utils.setup2dQuad();

    if (this._effect === 'label') {
      this._setupColorizeShader();
    } else {
      this._setupExtractShader();

      if (this._effect === 'blur') {
        this._setupBlurShader();
      } else if (this._effect === 'fill') {
        this._setupFillShader();
      }

      this._setupBlendShader();
    }
  }

  _setupColorizeShader() {

    const vs =
      `#version 300 es
      in vec4 a_pos;
      out vec2 v_texcoord;
      out vec2 v_maskcord;

      void main() {
        gl_Position = a_pos;
        v_texcoord = a_pos.xy * vec2(0.5, -0.5) + 0.5;
        v_maskcord = v_texcoord * ${this._correctionFactor};
      }`;

    const fs =
      `#version 300 es
      precision highp float;
      out vec4 out_color;

      uniform sampler2D u_image;
      uniform sampler2D u_predictions;
      uniform sampler2D u_palette;
      uniform int u_length;
      uniform float u_alpha;

      in vec2 v_maskcord;
      in vec2 v_texcoord;

      void main() {
        float label_index = texture(u_predictions, v_maskcord).a * 255.0;
        vec4 label_color = texture(u_palette, vec2((label_index + 0.5) / float(u_length), 0.5));
        vec4 im_color = texture(u_image, v_texcoord);
        out_color = mix(im_color, label_color, u_alpha);
      }`;

    this.shaders.colorize = new Shader(this._gl, vs, fs);
    this.shaders.colorize.use();
    this.shaders.colorize.set1i('u_image', 0); // texture units 0
    this.shaders.colorize.set1i('u_predictions', 1); // texture units 1
    this.shaders.colorize.set1i('u_palette', 2); // texture units 2
    this.shaders.colorize.set1i('u_length', this._colorPalette.length / 3);

    this.utils._tex.palette = this.utils.createAndBindTexture(this._gl.NEAREST);
    this._gl.texImage2D(
      this._gl.TEXTURE_2D,
      0,
      this._gl.RGB,
      this._colorPalette.length / 3,
      1,
      0,
      this._gl.RGB,
      this._gl.UNSIGNED_BYTE,
      this._colorPalette
    );
  }

  _setupExtractShader() {

    const vs =
      `#version 300 es
      in vec4 a_pos;
      out vec2 v_texcoord;
      out vec2 v_maskcord;

      void main() {
        gl_Position = a_pos;
        v_texcoord = a_pos.xy * vec2(0.5, -0.5) + 0.5;
        v_maskcord = (a_pos.xy * vec2(0.5, 0.5) + 0.5);// * ${this._correctionFactor};
      }`;

    const fs =
      `#version 300 es
      precision highp float;
      layout(location = 0) out vec4 fg_color;
      layout(location = 1) out vec4 bg_color;

      uniform sampler2D u_mask;
      uniform sampler2D u_image;

      in vec2 v_maskcord;
      in vec2 v_texcoord;

      void main() {
        float fg_alpha= texture(u_mask, v_maskcord).a;
        float bg_alpha = 1.0 - fg_alpha;

        vec4 pixel = texture(u_image, v_texcoord);
        fg_color = vec4(pixel.xyz * fg_alpha, fg_alpha);
        bg_color = vec4(pixel.xyz * bg_alpha, bg_alpha);
      }`;

    this.shaders.extract = new Shader(this._gl, vs, fs);
    this.utils.createTexInFrameBuffer('extract',
      [{
        texName: 'fg',
        width: this._clippedSize[0] * this._zoom,
        height: this._clippedSize[1] * this._zoom,
      }, {
        texName: 'bg',
        width: this._clippedSize[0] * this._zoom,
        height: this._clippedSize[1] * this._zoom,
      }]
    );
    this.shaders.extract.use();
    this.shaders.extract.set1i('u_image', 0); // texture units 0
    this.shaders.extract.set1i('u_mask', 1); // texture units 1
  }

  _setupBlurShader() {

    const vs =
      `#version 300 es
      in vec4 a_pos;
      out vec2 v_texcoord;

      void main() {
        gl_Position = a_pos;
        v_texcoord = a_pos.xy * vec2(0.5, 0.5) + 0.5;
      }`;

    const fs =
      `#version 300 es
      precision highp float;
      out vec4 out_color;
      in vec2 v_texcoord;

      uniform sampler2D bg;
      uniform bool first_pass;
      uniform int raidius;
      uniform float kernel[${this._blurRadius + 1}];

      // https://learnopengl.com/code_viewer_gh.php?code=src/5.advanced_lighting/7.bloom/7.blur.fs

      void main() {             
        vec2 tex_offset = 1.0 / vec2(textureSize(bg, 0)); // gets size of single texel
        vec4 bg_color = texture(bg, v_texcoord);
        vec4 result = bg_color * kernel[0];
        if (first_pass) {
          for (int i = 1; i < ${this._blurRadius + 1}; ++i) {
            result += texture(bg, v_texcoord + vec2(tex_offset.x * float(i), 0.0)) * kernel[i];
            result += texture(bg, v_texcoord - vec2(tex_offset.x * float(i), 0.0)) * kernel[i];
          }
        } else {
          for (int i = 1; i < ${this._blurRadius + 1}; ++i) {
            result += texture(bg, v_texcoord + vec2(0.0, tex_offset.y * float(i))) * kernel[i];
            result += texture(bg, v_texcoord - vec2(0.0, tex_offset.y * float(i))) * kernel[i];
          }
        }
        out_color = result;
      }`;

    this.shaders.blur = new Shader(this._gl, vs, fs);
    this.utils.createTexInFrameBuffer('blurFirstPassResult',
      [{
        texName: 'blurFirstPassResult',
        width: this._clippedSize[0] * this._zoom,
        height: this._clippedSize[1] * this._zoom,
      }]
    );

    this.utils.createTexInFrameBuffer('styledBg',
      [{
        texName: 'styledBg',
        width: this._clippedSize[0] * this._zoom,
        height: this._clippedSize[1] * this._zoom,
      }]
    );
  }

  _setupFillShader() {

    const vs =
      `#version 300 es
      in vec4 a_pos;
      out vec2 v_texcoord;

      void main() {
        gl_Position = a_pos;
        v_texcoord = a_pos.xy * vec2(0.5, -0.5) + 0.5;
      }`;

    const fs =
      `#version 300 es
      precision highp float;

      in vec2 v_texcoord;
      out vec4 out_color;
      uniform vec4 fill_color;

      void main() {

        // checkerboard background
        // vec2 offset = floor(v_texcoord * BG_SIZE / 10.0) ;
        // if (mod(offset.x, 2.0) == 0.0) {
        //   if (mod(offset.y, 2.0) == 0.0) {
        //     out_color = vec4(1.0,1.0,1.0,1.0);
        //   } else {
        //     out_color = vec4(0.7,0.7,0.7,1.0);
        //   }
        // } else {
        //   if (mod(offset.y, 2.0) != 0.0) {
        //     out_color = vec4(1.0,1.0,1.0,1.0);
        //   } else {
        //     out_color = vec4(0.7,0.7,0.7,1.0);
        //   }
        // }

        // solid color background
        out_color = fill_color;
      }`;

    this.shaders.fill = new Shader(this._gl, vs, fs);
    this.utils.createTexInFrameBuffer('styledBg',
      [{
        texName: 'styledBg',
        width: this._clippedSize[0] * this._zoom,
        height: this._clippedSize[1] * this._zoom,
      }]
    );
  }

  _setupBlendShader() {

    const vs =
      `#version 300 es
      in vec4 a_pos;
      out vec2 v_texcoord;

      void main() {
        gl_Position = a_pos;
        v_texcoord = a_pos.xy * vec2(0.5, 0.5) + 0.5;
      }`;

    const fs =
      `#version 300 es
      precision highp float;

      in vec2 v_texcoord;
      out vec4 out_color;

      uniform sampler2D fg;
      uniform sampler2D bg;
      uniform sampler2D orig;

      void main() {
        vec4 fg_color = texture(fg, v_texcoord);
        vec4 bg_color = texture(bg, v_texcoord);
        vec4 orig_color = texture(orig, vec2(v_texcoord.x, (1.0-v_texcoord.y)));
        bg_color = bg_color + (1.0 - bg_color.a) * orig_color;
        out_color = fg_color + (1.0 - fg_color.a) * bg_color;
      }`;

    this.shaders.blend = new Shader(this._gl, vs, fs);
    this.shaders.blend.use();
    this.shaders.blend.set1i('fg', 0); // texture units 0
    this.shaders.blend.set1i('bg', 1); // texture units 1
    this.shaders.blend.set1i('orig', 2); // texture units 2
  }

  async uploadNewTexture(imageSource, clippedSize) {

    if (this._clippedSize[0] !== clippedSize[0] ||
      this._clippedSize[1] !== clippedSize[1]) {
      this._clippedSize = clippedSize;

      // all FRAMEBUFFERs should be re-setup when clippedSize changes 
      this.setup();
    }

    this._imageSource = imageSource;

    this.utils._tex.image = this.utils.createAndBindTexture(this._gl.LINEAR);
    this._gl.texImage2D(
      this._gl.TEXTURE_2D,
      0,
      this._gl.RGBA,
      this._gl.RGBA,
      this._gl.UNSIGNED_BYTE,
      imageSource
    );
  }

  async drawOutputs(newSegMap) {

    let start = performance.now();

    if (typeof newSegMap !== 'undefined') {
      this._segMap = newSegMap;

      if (this.effect === 'label') {
        this._predictions = this._argmaxClippedSegMap(newSegMap);
        // upload predictions texture
        this.utils._tex.predictions = this.utils.createAndBindTexture(this._gl.NEAREST);
        this._gl.pixelStorei(this._gl.UNPACK_ALIGNMENT, 1);
        this._gl.texImage2D(
          this._gl.TEXTURE_2D,
          0,
          this._gl.ALPHA,
          this._clippedSize[0],
          this._clippedSize[1],
          0,
          this._gl.ALPHA,
          this._gl.UNSIGNED_BYTE,
          this._predictions
        );
      } else {
        // convert precdictions to a binary mask
        this._predictions = this._argmaxClippedSegMapPerson(newSegMap);
        this.utils._tex.predictions = this._guidedFilter.apply(
          this._imageSource,
          this._predictions,
          this._clippedSize[0],
          this._clippedSize[1]
        );
      }

      this._gl.canvas.width = this._clippedSize[0] * this._zoom;
      this._gl.canvas.height = this._clippedSize[1] * this._zoom;
      this._gl.viewport(
        0,
        0,
        this._gl.drawingBufferWidth,
        this._gl.drawingBufferHeight
      );
    }

    if (this._effect === 'label') {
      this._drawColorLabel();
    } else {
      this._drawPerson();
    }

    let elapsed = performance.now() - start;
    console.log(`Draw time: ${elapsed.toFixed(2)} ms`);
    return elapsed;
  }

  _drawColorLabel() {
    let currShader = this.shaders.colorize;
    currShader.use();
    currShader.set1f('u_alpha', this._colorMapAlpha);
    this.utils.bindFramebuffer(null);
    this.utils.bindInputTexture(['image', 'predictions', 'palette']);
    this.utils.render();

    // generate label map. { labelName: [ labelName, rgbTuple ] }
    let uniqueLabels = new Set(this._predictions);
    let labelMap = {};
    for (let labelId of uniqueLabels) {
      let labelName = this._segMap.labels[labelId];
      let rgbTuple = this._colorPalette.slice(labelId * 3, (labelId + 1) * 3);
      labelMap[labelId] = [labelName, rgbTuple];
    }
    this._showLegends(labelMap);
    return labelMap;
  }

  _showLegends(labelMap) {
    $('.labels-wrapper').empty();
    for (let id in labelMap) {
      let labelDiv = $(`<div class="col-12 seg-label" data-label-id="${id}"/>`)
        .append($(`<span style="color:rgb(${labelMap[id][1]})">⬤</span>`))
        .append(`${labelMap[id][0]}`);
      $('.labels-wrapper').append(labelDiv);
    }
  }

  highlightHoverLabel(hoverPos) {
    if (hoverPos === null) {
      // clear highlight when mouse leaving canvas
      $('.seg-label').removeClass('highlight');
      return;
    }

    let outputW = this._clippedSize[0];
    let x = Math.floor(this._correctionFactor * hoverPos.x / this._zoom);
    let y = Math.floor(this._correctionFactor * hoverPos.y / this._zoom);
    let labelId = this._predictions[x + y * outputW];

    $('.seg-label').removeClass('highlight');
    $('.labels-wrapper').find(`[data-label-id="${labelId}"]`).addClass('highlight');
  }

  _drawPerson() {

    // feed image and mask into extract shader
    let currShader;
    this.shaders.extract.use();
    this.utils.bindFramebuffer('extract');
    this.utils.bindInputTexture(['image', 'predictions']);
    this.utils.render();

    if (this._effect == 'blur') {
      // feed extracted background into blur shader
      currShader = this.shaders.blur;
      currShader.use();
      currShader.set1fv('kernel', this._halfKernel);

      currShader.set1i('first_pass', 1);
      this.utils.bindFramebuffer('blurFirstPassResult');
      this.utils.bindInputTexture(['bg']);
      this.utils.render();

      currShader.set1i('first_pass', 0);
      this.utils.bindFramebuffer('styledBg');
      this.utils.bindInputTexture(['blurFirstPassResult']);
      this.utils.render();
    } else {
      // feed extracted background into fill shader
      const fillColor = this._bgColor.map(x => x / 255);
      currShader = this.shaders.fill;
      currShader.use();
      currShader.set4f('fill_color', ...fillColor, 1);
      this.utils.bindFramebuffer('styledBg');
      this.utils.render();
    }

    // feed into blend shader
    this.shaders.blend.use();
    this.utils.bindFramebuffer(null);
    this.utils.bindInputTexture(['fg', 'styledBg', 'image']);
    this.utils.render();
  }


  _argmaxClippedSegMap(segmap) {

    const clippedHeight = this._clippedSize[1];
    const clippedWidth = this._clippedSize[0];
    const outputWidth = segmap.outputShape[1];
    const numClasses = segmap.outputShape[2];
    const data = segmap.data;
    const mask = new Uint8Array(clippedHeight * clippedWidth);

    let i = 0;
    for (let h = 0; h < clippedHeight; h++) {
      const starth = h * outputWidth * numClasses;
      for (let w = 0; w < clippedWidth; w++) {
        const startw = starth + w * numClasses;
        let maxVal = Number.MIN_SAFE_INTEGER;
        let maxIdx = 0;
        for (let n = 0; n < numClasses; n++) {
          if (data[startw + n] > maxVal) {
            maxVal = data[startw + n];
            maxIdx = n;
          }
        }
        mask[i++] = maxIdx;
      }
    }

    return mask;
  }

  _argmaxClippedSegMapPerson(segmap) {

    const PERSON_ID = 15;
    const clippedHeight = this._clippedSize[1];
    const clippedWidth = this._clippedSize[0];
    const outputWidth = segmap.outputShape[1];
    const numClasses = segmap.outputShape[2];
    const data = segmap.data;
    const mask = new Uint8Array(clippedHeight * clippedWidth);

    let i = 0;
    for (let h = 0; h < clippedHeight; h++) {
      const starth = h * outputWidth * numClasses;
      for (let w = 0; w < clippedWidth; w++) {
        const startw = starth + w * numClasses;
        let maxVal = Number.MIN_SAFE_INTEGER;
        let maxIdx = 0;
        for (let n = 0; n < numClasses; n++) {
          if (data[startw + n] > maxVal) {
            maxVal = data[startw + n];
            maxIdx = n;
          }
        }
        mask[i++] = maxIdx === PERSON_ID ? 255 : 0;
      }
    }

    return mask;
  }

  _generateGaussianKernel1D(kernelSize, sigma = 30) {
    const gaussian = (x, sigma) =>
      1 / (Math.sqrt(2 * Math.PI) * sigma) * Math.exp(-x * x / (2 * sigma * sigma));
    const kernel = [];
    const radius = (kernelSize - 1) / 2;
    for (let x = -radius; x <= radius; x++) {
      kernel.push(gaussian(x, sigma));
    }

    // normalize kernel
    const sum = kernel.reduce((x, y) => x + y);
    return kernel.map((x) => x / sum);
  }
}