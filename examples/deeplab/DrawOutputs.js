class Renderer {
  constructor(canvas) {
    this._gl = canvas.getContext('webgl2');
    if (this._gl === null) {
      throw new Error('Unable to initialize WebGL.');
    }

    this._program;
    this._mask;
    this._segMap;
    this._imageTexId = 0;
    this._maskTexId = 1;
    this._zoom = 2;
    this._bgcolor = [57, 135, 189, 255]; // rgba
  }

  get zoom() {
    return this._zoom;
  }

  set zoom(val) {
    this._zoom = val;
  }

  get bgcolor() {
    return this._bgcolor.slice(0, 3);
  }

  set bgcolor(rgb) {
    this._bgcolor[0] = rgb[0];
    this._bgcolor[1] = rgb[1];
    this._bgcolor[2] = rgb[2];
  }

  get zoom() {
    return this._zoom;
  }

  set zoom(val) {
    this._zoom = val;
  }

  setup() {
    let vertexShader = this._createShader(this._gl.VERTEX_SHADER, `
      attribute vec4 a_pos;
      varying vec2 v_texcoord;
      void main() {
        gl_Position = a_pos;
        v_texcoord = a_pos.xy * vec2(0.5, -0.5) + 0.5;
      }
    `);

    let fragmentShader = this._createShader(this._gl.FRAGMENT_SHADER, `
      precision highp float;
      uniform sampler2D u_mask;
      uniform sampler2D u_image;
      uniform vec4 u_bgcolor;
      varying vec2 v_texcoord;
      void main() {
        vec4 mask = texture2D(u_mask, v_texcoord * vec2(0.99, 0.99));
        vec4 fg = texture2D(u_image, v_texcoord);
        vec4 bg = u_bgcolor / vec4(255, 255, 255, 255);
        gl_FragColor = mix(fg, bg, mask.a);
      }
    `);

    this._program = this._createProgram(vertexShader, fragmentShader);
    this._gl.useProgram(this._program);

    // setup a rectangle draw area
    let rect = new Float32Array([
      -1, -1,
      1, -1,
      1, 1,
      1, 1,
      -1, 1,
      -1, -1
    ]);
    let vbo = this._gl.createBuffer();
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, vbo);
    this._gl.bufferData(this._gl.ARRAY_BUFFER, rect, this._gl.STATIC_DRAW);
    this._gl.enableVertexAttribArray(0);
    this._gl.vertexAttribPointer(0, 2, this._gl.FLOAT, false, 0, 0);

    // texture units 0 and 1 for the mask and image
    let maskLoc = this._gl.getUniformLocation(this._program, 'u_mask');
    let imageLoc = this._gl.getUniformLocation(this._program, 'u_image');
    this._gl.uniform1i(maskLoc, this._maskTexId);
    this._gl.uniform1i(imageLoc, this._imageTexId);

    this._activeTexture(this._imageTexId);
    this._createTexture();

    this._activeTexture(this._maskTexId);
    this._createTexture();
    this._gl.pixelStorei(this._gl.UNPACK_ALIGNMENT, 1);
  }

  _argmaxPerson(array, span) {
    const PERSON_ID = 15;
    const len = array.length / span;
    const mask = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      let maxVal = Number.MIN_SAFE_INTEGER;
      let maxIdx = 0;
      for (let j = 0; j < span; j++) {
        if (array[i * span + j] > maxVal) {
          maxVal = array[i * span + j];
          maxIdx = j;
        }
      }
      mask[i] = maxIdx === PERSON_ID ? 0 : 255;
    }
    return mask;
  }

  async uploadNewTexture(canvas, scaledShape) {
    let id = Date.now(); // used for sync
    return new Promise(resolve => {
      // back up the current active texture
      let currTexId = this._gl.getParameter(this._gl.ACTIVE_TEXTURE);

      this._activeTexture(this._imageTexId);
      this._gl.texImage2D(
        this._gl.TEXTURE_2D,
        0,
        this._gl.RGBA,
        this._gl.RGBA,
        this._gl.UNSIGNED_BYTE,
        canvas
      );
      // restore the active texture
      this._gl.activeTexture(currTexId);
      resolve(id);
    });
  }

  drawOutputs(newSegMap) {

    let start = performance.now();

    if (typeof newSegMap !== 'undefined') {
      this._segMap = newSegMap;
      let numOutputClasses = newSegMap.outputShape[2];
      this._mask = this._argmaxPerson(newSegMap.data, numOutputClasses);
    }

    let scaledWidth = this._segMap.scaledShape[0];
    let scaledHeight = this._segMap.scaledShape[1];
    let outputWidth = this._segMap.outputShape[0];
    let outputHeight = this._segMap.outputShape[1];
    let isScaled = outputWidth === scaledWidth || outputHeight === scaledHeight;

    this._gl.canvas.width = scaledWidth * this._zoom;
    this._gl.canvas.height = scaledHeight * this._zoom;

    // upload mask
    this._activeTexture(this._maskTexId);
    this._gl.texImage2D(
      this._gl.TEXTURE_2D,
      0,
      this._gl.ALPHA,
      isScaled ? scaledWidth : outputWidth,
      isScaled ? scaledHeight : outputHeight,
      0,
      this._gl.ALPHA,
      this._gl.UNSIGNED_BYTE,
      this._mask
    );

    const bgcolorLoc = this._gl.getUniformLocation(this._program, 'u_bgcolor');
    this._gl.uniform4f(bgcolorLoc, ...this._bgcolor);
    this._gl.viewport(0, 0, this._gl.canvas.width, this._gl.canvas.height);
    this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);

    console.log(`Draw time: ${(performance.now() - start).toFixed(2)} ms`);
  }



  // GL helper functions
  _createShader(type, source) {
    let shader = this._gl.createShader(type);
    this._gl.shaderSource(shader, source);
    this._gl.compileShader(shader);
    if (this._gl.getShaderParameter(shader, this._gl.COMPILE_STATUS)) {
      return shader;
    }
    console.log(this._gl.getShaderInfoLog(shader));
    this._gl.deleteShader(shader);
  }

  _createProgram(vertexShader, fragmentShader) {
    let program = this._gl.createProgram();
    this._gl.attachShader(program, vertexShader);
    this._gl.attachShader(program, fragmentShader);
    this._gl.linkProgram(program);
    if (this._gl.getProgramParameter(program, this._gl.LINK_STATUS)) {
      return program;
    }
    console.log(this._gl.getProgramInfoLog(program));
    this._gl.deleteProgram(program);
  }

  _createTexture() {
    let texture = this._gl.createTexture();
    this._gl.bindTexture(this._gl.TEXTURE_2D, texture);

    this._gl.texParameteri(
      this._gl.TEXTURE_2D,
      this._gl.TEXTURE_WRAP_S,
      this._gl.CLAMP_TO_EDGE
    );
    this._gl.texParameteri(
      this._gl.TEXTURE_2D,
      this._gl.TEXTURE_WRAP_T,
      this._gl.CLAMP_TO_EDGE
    );
    this._gl.texParameteri(
      this._gl.TEXTURE_2D,
      this._gl.TEXTURE_MIN_FILTER,
      this._gl.NEAREST
    );
    this._gl.texParameteri(
      this._gl.TEXTURE_2D,
      this._gl.TEXTURE_MAG_FILTER,
      this._gl.NEAREST
    );
    return texture;
  }

  _activeTexture(texId) {
    this._gl.activeTexture(this._gl.TEXTURE0 + texId);
  }
}