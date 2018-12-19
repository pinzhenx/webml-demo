class Shader {
  constructor(gl, vertShaderSrc, fragShaderSrc) {
    this._gl = gl;
    this._loc = {};
    let vs = this._createShader(this._gl.VERTEX_SHADER, vertShaderSrc);
    let fs = this._createShader(this._gl.FRAGMENT_SHADER, fragShaderSrc);
    this._prog = this._createProgram(vs, fs);
  }

  use() {
    this._gl.useProgram(this._prog);
  }

  set1i(name, x) {
    this._gl.uniform1i(this._gl.getUniformLocation(this._prog, name), x);
  }

  set4f(name, w, x, y, z) {
    this._gl.uniform4f(this._gl.getUniformLocation(this._prog, name), w, x, y, z);
  }

  set2f(name, x, y) {
    this._gl.uniform2f(this._gl.getUniformLocation(this._prog, name), x, y);
  }

  set1f(name, x) {
    this._gl.uniform1f(this._gl.getUniformLocation(this._prog, name), x);
  }

  set1fv(name, arr) {
    this._gl.uniform1fv(this._gl.getUniformLocation(this._prog, name), arr);
  }

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
}