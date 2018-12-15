class GuidedFilter {
  constructor(context) {

    this._gl = context;
    this.utils = new WebGLUtils(context);

    if (!this._gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('not support EXT_color_buffer_float');
    }

    if (!this._gl.getExtension('OES_texture_float_linear')) {
      throw new Error('not support OES_texture_float_linear');
    }

    this.shaders = {};

    this.width = 513;
    this.height = 513;
    this.subsample = 4;
    this.radius = 16;
    this.epsilon = 0.000001;
    if (this.radius < 4) {
      this.subRadius = this.radius;
      this.subWidth = this.width;
      this.subHeight = this.height;
    } else {
      this.subRadius = this.radius / this.subsample;
      this.subWidth = this.width / this.subsample;
      this.subHeight = this.height / this.subsample;
    }
  }

  setup(radius, epsilon, width, height) {

    this.radius = radius;
    this.epsilon = epsilon;
    this.width = width;
    this.height = height;
    if (this.radius < 4) {
      this.subRadius = this.radius;
      this.subWidth = this.width;
      this.subHeight = this.height;
    } else {
      this.subRadius = this.radius / this.subsample;
      this.subWidth = this.width / this.subsample;
      this.subHeight = this.height / this.subsample;
    }

    this._setupQuad();
    this._setupHadamard4Shader();
    this._setupBoxFilterShader();
    this._setupHadamard2Shader();
    this._setupCovarShader();
    this._setupFinalShader();

  }

  _setupQuad() {
    const quad = new Float32Array([-1, -1, 1, -1, 1, 1, 1, 1, -1, 1, -1, -1]);
    const vbo = this._gl.createBuffer();
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, vbo);
    this._gl.bufferData(this._gl.ARRAY_BUFFER, quad, this._gl.STATIC_DRAW);
    this._gl.enableVertexAttribArray(0);
    this._gl.vertexAttribPointer(0, 2, this._gl.FLOAT, false, 0, 0);
  }

  _setupHadamard4Shader() {

    const vs =
      `#version 300 es
        in vec4 a_pos;
        out vec2 v_texcoord;
        out vec2 v_maskcoord;
  
        void main() {
          gl_Position = a_pos;
          v_texcoord = a_pos.xy * vec2(0.5, -0.5) + 0.5;
          v_maskcoord = v_texcoord * 0.99;
        }`;

    const fs =
      `#version 300 es
        precision highp float;
  
        out vec4 result;
  
        uniform sampler2D u_p;
        uniform sampler2D u_I;
  
        in vec2 v_texcoord;
        in vec2 v_maskcoord;
  
        void main() {
          float I = texture(u_I, v_texcoord).x;
          float p = texture(u_p, v_maskcoord).a;
          float Ip = I * p;
          float II = I * I;
          result = vec4(I, p, Ip, II);
        }`;

    this.shaders.hadamard4 = new Shader(this._gl, vs, fs);

    this.utils.createTexInFrameBuffer('fbo1',
      [{
        texName: 'result1',
        width: this.subWidth,
        height: this.subHeight,
        filter: this._gl.NEAREST,
        type: this._gl.FLOAT,
        internalformat: this._gl.RGBA32F,
      }]
    );
    this.shaders.hadamard4.use();
    this.shaders.hadamard4.set1i('u_p', 0); // texture units 0
    this.shaders.hadamard4.set1i('u_I', 1); // texture units 1
  }


  _setupBoxFilterShader() {

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
        uniform int radius;
  
        void main() {             
          vec2 tex_offset = 1.0 / vec2(textureSize(bg, 0));
          vec4 result = texture(bg, v_texcoord);
          if (first_pass) {
            for (int i = 1; i <= radius; ++i) {
              result += texture(bg, v_texcoord + vec2(tex_offset.x * float(i), 0.0));
              result += texture(bg, v_texcoord - vec2(tex_offset.x * float(i), 0.0));
            }
          } else {
            for (int i = 1; i <= radius; ++i) {
              result += texture(bg, v_texcoord + vec2(0.0, tex_offset.y * float(i)));
              result += texture(bg, v_texcoord - vec2(0.0, tex_offset.y * float(i)));
            }
          }
          out_color = result / (2.0 * float(radius) + 1.0);
        }`;

    this.shaders.boxFilter = new Shader(this._gl, vs, fs);
    this.utils.createTexInFrameBuffer('pingpong',
      [{
        texName: 'pingpongTemp',
        width: this.subWidth,
        height: this.subHeight,
        filter: this._gl.LINEAR,
        type: this._gl.FLOAT,
        internalformat: this._gl.RGBA32F,
      }]
    );

    this.utils.createTexInFrameBuffer('fbo2',
      [{
        texName: 'result2',
        width: this.subWidth,
        height: this.subHeight,
        filter: this._gl.LINEAR,
        type: this._gl.FLOAT,
        internalformat: this._gl.RGBA32F,
      }]
    );

    this.utils.createTexInFrameBuffer('fbo5',
      [{
        texName: 'result5',
        width: this.width,
        height: this.height,
        filter: this._gl.LINEAR,
        type: this._gl.FLOAT,
        internalformat: this._gl.RGBA32F,
      }]
    );
  }


  _setupHadamard2Shader() {

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
  
        out vec4 result;
  
        uniform sampler2D result2;
  
        in vec2 v_texcoord;
  
        void main() {
          vec4 prev = texture(result2, v_texcoord);
          float mean_I = prev.x;
          float mean_p = prev.y;
          result.xy = vec2(mean_I * mean_p, mean_I * mean_I);
          //result = vec4(mean_I * mean_p, mean_I * mean_p, mean_I * mean_p, 1.0);
        }`;

    this.shaders.hadamard2 = new Shader(this._gl, vs, fs);

    this.utils.createTexInFrameBuffer('fbo3',
      [{
        texName: 'result3',
        width: this.subWidth,
        height: this.subHeight,
        filter: this._gl.NEAREST,
        type: this._gl.FLOAT,
        internalformat: this._gl.RGBA32F,
      }]
    );
  }


  _setupCovarShader() {

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
  
        out vec4 result;
  
        uniform sampler2D result2;
        uniform sampler2D result3;
        uniform float epsilon;
  
        in vec2 v_texcoord;
  
        void main() {
          vec4 r2 = texture(result2, v_texcoord);
          float meanI = r2.x;
          float meanp = r2.y;
          float meanIp = r2.z;
          float meanII = r2.a;
          vec4 r3 = texture(result3, v_texcoord);
          float meanI_meanp = r3.x;
          float meanI_meanI = r3.y;
  
          // cov_Ip = mean_Ip - mean_I .* mean_p;
          // var_I = mean_II - mean_I .* mean_I;
          
          // a = cov_Ip ./ (var_I + eps);
          // b = mean_p - a .* mean_I;
  
          float covIp = meanIp - meanI_meanp; // this is the covariance of (I, p) in each local patch.
          float varI = meanII - meanI_meanI;
          float a = covIp / (varI + epsilon);
          float b = meanp - a * meanI;
          result.xy = vec2(a, b);
          //result = vec4(a,a,a, 1.0);
        }`;

    this.shaders.covar = new Shader(this._gl, vs, fs);

    this.shaders.covar.use();
    this.shaders.covar.set1i('result2', 0); // texture units 0
    this.shaders.covar.set1i('result3', 1); // texture units 1

    this.utils.createTexInFrameBuffer('fbo4',
      [{
        texName: 'result4',
        width: this.subWidth,
        height: this.subHeight,
        filter: this._gl.NEAREST,
        type: this._gl.FLOAT,
        internalformat: this._gl.RGBA32F,
      }]
    );
  }

  _setupFinalShader() {

    const vs =
      `#version 300 es
        in vec4 a_pos;
        out vec2 v_texcoord;
        out vec2 v_flipcord;
  
        void main() {
          gl_Position = a_pos;
          v_texcoord = a_pos.xy * vec2(0.5, 0.5) + 0.5;
          v_flipcord = a_pos.xy * vec2(0.5, -0.5) + 0.5;
        }`;

    const fs =
      `#version 300 es
        precision highp float;
  
        out vec4 result;
  
        uniform sampler2D result5;
        uniform sampler2D u_I;
  
        in vec2 v_flipcord;
        in vec2 v_texcoord;
  
        void main() {
          vec4 r5 = texture(result5, v_texcoord);
          vec4 I = texture(u_I, v_flipcord);
          float mean_a = r5.x;
          float mean_b = r5.y;
  
          // q = mean_a .* I + mean_b;
          float intensity = mean_a * I.z + mean_b;
          result = vec4(intensity, intensity, intensity, intensity);
          // result = vec4(mean_a * I.x, mean_a * I.x, mean_a * I.x, 1.0);
  
        }`;

    this.shaders.final = new Shader(this._gl, vs, fs);

    this.shaders.final.use();
    this.shaders.final.set1i('result5', 0); // texture units 0
    this.shaders.final.set1i('u_I', 1); // texture units 1

    // this.utils.createTexInFrameBuffer('fbo6',
    //   [{
    //     texName: 'result6',
    //     width: this.subWidth,
    //     height: this.subHeight,
    //     filter: this._gl.NEAREST,
    //     type: this._gl.FLOAT,
    //     internalformat: this._gl.RGBA32F,
    //   }]
    // );
    this.utils.createTexInFrameBuffer('fbo6',
      [{
        texName: 'result6',
        width: this.width,
        height: this.height,
        filter: this._gl.LINEAR,
      }]
    );
  }

  apply(guideImage, input, maskWidth, maskHeight) {
    let start = performance.now();

    this.utils._tex.p = this.utils.createAndBindTexture(this._gl.NEAREST);
    this._gl.pixelStorei(this._gl.UNPACK_ALIGNMENT, 1);
    this._gl.texImage2D(
      this._gl.TEXTURE_2D,
      0,
      this._gl.ALPHA,
      maskWidth,
      maskHeight,
      0,
      this._gl.ALPHA,
      this._gl.UNSIGNED_BYTE,
      input
    );

    this.utils._tex.I = this.utils.createAndBindTexture(this._gl.LINEAR);
    this._gl.texImage2D(
      this._gl.TEXTURE_2D,
      0,
      this._gl.LUMINANCE,
      this._gl.LUMINANCE,
      this._gl.UNSIGNED_BYTE,
      guideImage
    );

    this.shaders.hadamard4.use();
    this.utils.bindFramebuffer('fbo1');
    // this.utils.bindFramebuffer(null);
    this.utils.bindInputTexture(['p', 'I']);
    this._gl.viewport(0, 0, this.subWidth, this.subHeight);
    this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);

    this.shaders.boxFilter.use();
    this.shaders.boxFilter.set1i('first_pass', 1);
    this.shaders.boxFilter.set1i('radius', this.subRadius);
    this.utils.bindFramebuffer('pingpong');
    this.utils.bindInputTexture(['result1']);
    this._gl.viewport(0, 0, this.subWidth, this.subHeight);
    this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);

    this.shaders.boxFilter.set1i('first_pass', 0);
    this.utils.bindFramebuffer('fbo2');
    this.utils.bindInputTexture(['pingpongTemp']);
    this._gl.viewport(0, 0, this.subWidth, this.subHeight);
    this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);

    this.shaders.hadamard2.use();
    this.utils.bindFramebuffer('fbo3');
    this.utils.bindInputTexture(['result2']);
    this._gl.viewport(0, 0, this.subWidth, this.subHeight);
    this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);

    this.shaders.covar.use();
    this.shaders.covar.set1f('epsilon', this.epsilon);
    this.utils.bindFramebuffer('fbo4');
    this.utils.bindInputTexture(['result2', 'result3']);
    this._gl.viewport(0, 0, this.subWidth, this.subHeight);
    this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);

    this.shaders.boxFilter.use();
    this.shaders.boxFilter.set1i('first_pass', 1);
    this.shaders.boxFilter.set1i('radius', this.subRadius);
    this.utils.bindFramebuffer('pingpong');
    this.utils.bindInputTexture(['result4']);
    this._gl.viewport(0, 0, this.subWidth, this.subHeight);
    this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);

    this.shaders.boxFilter.set1i('first_pass', 0);
    this.utils.bindFramebuffer('fbo5');
    this.utils.bindInputTexture(['pingpongTemp']);
    this._gl.viewport(0, 0, this.width, this.height);
    this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);

    this.shaders.final.use();
    this.utils.bindFramebuffer('fbo6');
    // this.utils.bindFramebuffer(null);
    this.utils.bindInputTexture(['result5', 'I']);
    // this._gl.canvas.width = this.width;
    // this._gl.canvas.height = this.height;
    // this._gl.viewport(0, 0, this.width, this.height);
    this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);

    let elapsed = performance.now() - start;
    console.log(`Guided Filter time: ${elapsed.toFixed(2)} ms`);
    return this.utils._tex.result6;
  }
}