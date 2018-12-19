class WebGLUtils {
  constructor(context) {

    this._gl = context;
    this._tex = {};
    this._fbo = {};

  }

  setup2dQuad() {
    const quad = new Float32Array([-1, -1, 1, -1, 1, 1, 1, 1, -1, 1, -1, -1]);
    const vbo = this._gl.createBuffer();
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, vbo);
    this._gl.bufferData(this._gl.ARRAY_BUFFER, quad, this._gl.STATIC_DRAW);
    this._gl.enableVertexAttribArray(0);
    this._gl.vertexAttribPointer(0, 2, this._gl.FLOAT, false, 0, 0);
  }

  createAndBindTexture(filter = this._gl.NEAREST) {
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
      filter
    );
    this._gl.texParameteri(
      this._gl.TEXTURE_2D,
      this._gl.TEXTURE_MAG_FILTER,
      filter
    );
    return texture;
  }

  bindInputTexture(textures) {
    for (let i = 0; i < textures.length; i++) {
      this._gl.activeTexture(this._gl.TEXTURE0 + i);
      this._gl.bindTexture(this._gl.TEXTURE_2D, this._tex[textures[i]]);
    }
  }

  bindFramebuffer(fboName) {
    if (fboName === null) {
      this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);
    } else {
      this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this._fbo[fboName]);
    }
  }

  createTexInFrameBuffer(fboName, texturesConfig) {

    const newFbo = this._gl.createFramebuffer();
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, newFbo);
    this._fbo[fboName] = newFbo;

    const attachments = [];

    for (let i = 0; i < texturesConfig.length; i++) {

      const config = texturesConfig[i];
      const filter = config.filter || this._gl.LINEAR;
      const target = config.target || this._gl.TEXTURE_2D;
      const level = config.level || 0;
      const width = config.width || 1;
      const height = config.height || 1;
      const border = config.border || 0;
      const format = config.format || this._gl.RGBA;
      const internalformat = config.internalformat || format;
      const type = config.type || this._gl.UNSIGNED_BYTE;
      const source = config.format || null;
      const attach = (config.attach || i) + this._gl.COLOR_ATTACHMENT0;
      attachments.push(attach);

      const newTex = this.createAndBindTexture(filter);

      this._gl.texImage2D(
        target,
        level,
        internalformat,
        width,
        height,
        border,
        format,
        type,
        source
      );

      this._gl.framebufferTexture2D(
        this._gl.FRAMEBUFFER,
        attach,
        this._gl.TEXTURE_2D,
        newTex,
        0
      );

      this._tex[config.texName] = newTex;
    }

    if (attachments.length > 1) {
      this._gl.drawBuffers(attachments);
    }

    let status = this._gl.checkFramebufferStatus(this._gl.FRAMEBUFFER);
    if (status !== this._gl.FRAMEBUFFER_COMPLETE) {
      console.warn('FBO is not complete');
    }

    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);
  }

  setViewport(width, height) {
    this._gl.viewport(0, 0, width, height);
  }

  render() {
    this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);
  }

  _toFastProperties(obj) { // simulate %ToFastProperties
    function DummyConstructor() {
      this.x = 0;
    }
    DummyConstructor.prototype = obj;
    new DummyConstructor();
    new DummyConstructor();
  }

  freeze() {
    if (window.chrome) {
      this._toFastProperties(this._tex);
      this._toFastProperties(this._fbo);
    }
  }
}