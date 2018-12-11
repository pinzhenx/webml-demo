class Renderer {
  constructor(canvas) {
    this._gl = canvas.getContext('webgl2');
    if (this._gl === null) {
      throw new Error('Unable to initialize WebGL.');
    }

    this._program;
    this._mask;
    this._segMap;
    this._zoom = 1;
    this._bgcolor = [57, 135, 189]; // rgb
    this._blurRadius = 1;
    this._effect = 'fill';
  }

  get zoom() {
    return this._zoom;
  }

  set zoom(val) {
    this._zoom = val;
    this.drawOutputs();
  }

  get bgcolor() {
    return this._bgcolor;
  }

  set bgcolor(rgb) {
    this._bgcolor = rgb;
    this.drawOutputs();
  }

  get blurRadius() {
    return this._blurRadius;
  }

  set blurRadius(val) {
    this._blurRadius = val;
    this.drawOutputs();
  }

  get effect() {
    return this._effect;
  }

  set effect(val) {
    this._effect = val;
    this.drawOutputs();
  }

  setup() {

    let quad = new Float32Array([
      -1, -1,
      1, -1,
      1, 1,
      1, 1,
      -1, 1,
      -1, -1
    ]);
    let vbo = this._gl.createBuffer();
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, vbo);
    this._gl.bufferData(this._gl.ARRAY_BUFFER, quad, this._gl.STATIC_DRAW);
    this._gl.enableVertexAttribArray(0);
    this._gl.vertexAttribPointer(0, 2, this._gl.FLOAT, false, 0, 0);


    //
    // +------+                     +----+
    // |  im  |--.               .->| fg |-------------------.
    // +------+  |  ===========  |  +----+  ===============  |  ==========  
    //           |->| extract |--|          | blur shader |  |->| blend  |-> out
    // +------+  |  | shader  |  |  +----+  |     or      |  |  | shader |
    // | mask |--'  ===========  '->| bg |->| fill shader |--'  ==========
    // +------+                     +----+  ===============      
    //


    // Setup extract shader
    this.extractShader = new Shader(this._gl,
      `#version 300 es
      in vec4 a_pos;
      out vec2 v_texcoord;
      void main() {
        gl_Position = a_pos;
        v_texcoord = a_pos.xy * vec2(0.5, -0.5) + 0.5;
      }`,
      `#version 300 es
      precision highp float;
      layout(location = 0) out vec4 fg_color;
      layout(location = 1) out vec4 bg_color;

      uniform sampler2D u_mask;
      uniform sampler2D u_image;

      in vec2 v_texcoord;

      void main()
      {
        float bg_alpha = texture(u_mask, v_texcoord * vec2(0.99, 0.99)).a;
        float fg_alpha = 1.0 - bg_alpha;
        fg_color = vec4(texture(u_image, v_texcoord).xyz * fg_alpha, fg_alpha);
        bg_color = vec4(texture(u_image, v_texcoord).xyz * bg_alpha, bg_alpha);
      }`
    );
    
    this.extractFbo = this._createAndBindFrameBuffer();
    this.fgTex = this._createAndBindTexture(this._gl.LINEAR);
    this._gl.texImage2D(
      this._gl.TEXTURE_2D,
      0,
      this._gl.RGBA,
      224,
      224,
      0,
      this._gl.RGBA,
      this._gl.UNSIGNED_BYTE,
      null
    );
    this._gl.framebufferTexture2D(
      this._gl.FRAMEBUFFER,
      this._gl.COLOR_ATTACHMENT0,
      this._gl.TEXTURE_2D,
      this.fgTex,
      0
    );

    this.bgTex = this._createAndBindTexture(this._gl.LINEAR);
    this._gl.texImage2D(
      this._gl.TEXTURE_2D,
      0,
      this._gl.RGBA,
      224,
      224,
      0,
      this._gl.RGBA,
      this._gl.UNSIGNED_BYTE,
      null
    );
    this._gl.framebufferTexture2D(
      this._gl.FRAMEBUFFER,
      this._gl.COLOR_ATTACHMENT1,
      this._gl.TEXTURE_2D,
      this.bgTex,
      0
    );

    this._gl.drawBuffers([
      this._gl.COLOR_ATTACHMENT0,
      this._gl.COLOR_ATTACHMENT1
    ]);

    {
      let status = this._gl.checkFramebufferStatus(this._gl.FRAMEBUFFER);
      if (status !== this._gl.FRAMEBUFFER_COMPLETE) {
        console.warn('FBOs are not complete');
      }
    }
    // this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);



    // Setup blur shader
    this.blurShader = new Shader(this._gl,
      `#version 300 es
      in vec4 a_pos;
      out vec2 v_texcoord;
      
      void main() {
        gl_Position = a_pos;
        v_texcoord = a_pos.xy * vec2(0.5, 0.5) + 0.5;
      }`,
      `#version 300 es
      precision highp float;
      out vec4 out_color;
      in vec2 v_texcoord;

      uniform sampler2D bg;
      uniform bool first_pass;
      uniform float kernel[5];
      
      // https://learnopengl.com/code_viewer_gh.php?code=src/5.advanced_lighting/7.bloom/7.blur.fs

      void main()
      {             
        vec2 tex_offset = 1.0 / vec2(textureSize(bg, 0)); // gets size of single texel
        vec4 bg_color = texture(bg, v_texcoord);
        vec4 result = bg_color * kernel[0];
        if (first_pass) {
          for (int i = 1; i < 5; ++i) {
            result += texture(bg, v_texcoord + vec2(tex_offset.x * float(i), 0.0)) * kernel[i];
            result += texture(bg, v_texcoord - vec2(tex_offset.x * float(i), 0.0)) * kernel[i];
          }
        } else {
          for (int i = 1; i < 5; ++i) {
            result += texture(bg, v_texcoord + vec2(0.0, tex_offset.y * float(i))) * kernel[i];
            result += texture(bg, v_texcoord - vec2(0.0, tex_offset.y * float(i))) * kernel[i];
          }
        }
        out_color = result;
      }`);

    // this.blurShader = new Shader(this._gl,
    //   `#version 300 es
    //   in vec4 a_pos;
    //   out vec2 v_texcoord;
      
    //   void main() {
    //     gl_Position = a_pos;
    //     v_texcoord = a_pos.xy * vec2(0.5, 0.5) + 0.5;
    //   }`,
    //   `#version 300 es
    //   precision highp float;
    //   out vec4 out_color;
    //   in vec2 v_texcoord;

    //   uniform sampler2D bg;
    //   uniform bool first_pass;

    //   // https://software.intel.com/en-us/blogs/2014/07/15/an-investigation-of-fast-real-time-gpu-based-image-blur-algorithms
    //   // Kernel width 7 x 7
    //   uniform float gWeights[2];
    //   uniform float gOffsets[2];

    //   void main()
    //   {
    //     vec2 tex_offset = 1.0 / vec2(textureSize(bg, 0)); // gets size of single texel
    //     vec3 result = vec3(0, 0, 0);
    //     if (first_pass) {
    //       for (int i = 0; i < 2; i++) {
    //         vec3 col = texture(bg, v_texcoord + vec2(tex_offset.x * float(i), 0.0)).xyz +
    //                    texture(bg, v_texcoord - vec2(tex_offset.x * float(i), 0.0)).xyz;
    //         result += gWeights[i] * col;
    //       }
    //     } else {
    //       for (int i = 0; i < 2; i++) {
    //         vec3 col = texture(bg, v_texcoord + vec2(0.0, tex_offset.y * float(i))).xyz +
    //                    texture(bg, v_texcoord - vec2(0.0, tex_offset.y * float(i))).xyz;
    //         result += gWeights[i] * col;
    //       }
    //     }

    //     out_color = vec4(result, bg_color.a);
    //   }`);

    this.blurFirstPassResultFbo = this._createAndBindFrameBuffer();
    this.blurFirstPassResultTex = this._createAndBindTexture(this._gl.LINEAR);
    this._gl.texImage2D(
      this._gl.TEXTURE_2D,
      0,
      this._gl.RGBA,
      224,
      224,
      0,
      this._gl.RGBA,
      this._gl.UNSIGNED_BYTE,
      null
    );
    this._gl.framebufferTexture2D(
      this._gl.FRAMEBUFFER,
      this._gl.COLOR_ATTACHMENT0,
      this._gl.TEXTURE_2D,
      this.blurFirstPassResultTex,
      0
    );


    this.fillShader = new Shader(this._gl,
      `#version 300 es
      in vec4 a_pos;
      out vec2 v_texcoord;
      
      void main() {
        gl_Position = a_pos;
        v_texcoord = a_pos.xy * vec2(0.5, 0.5) + 0.5;
      }`,
      `#version 300 es
      precision highp float;

      in vec2 v_texcoord;
      out vec4 out_color;
      uniform vec4 fill_color;

      uniform sampler2D bg;
      
      void main() {
        float bg_alpha = texture(bg, v_texcoord).a;
        out_color = vec4(fill_color.xyz * bg_alpha, bg_alpha);
      }`);


    // Setup fill shader
    this.styledBackgroundFbo = this._createAndBindFrameBuffer();
    this.styledBgTex = this._createAndBindTexture(this._gl.LINEAR);
    this._gl.texImage2D(
      this._gl.TEXTURE_2D,
      0,
      this._gl.RGBA,
      224,
      224,
      0,
      this._gl.RGBA,
      this._gl.UNSIGNED_BYTE,
      null
    );
    this._gl.framebufferTexture2D(
      this._gl.FRAMEBUFFER,
      this._gl.COLOR_ATTACHMENT0,
      this._gl.TEXTURE_2D,
      this.styledBgTex,
      0
    );
    // this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);



    // Setup blend shader
    this.blendShader = new Shader(this._gl,
      `#version 300 es
      in vec4 a_pos;
      out vec2 v_texcoord;
      void main() {
        gl_Position = a_pos;
        v_texcoord = a_pos.xy * vec2(0.5, 0.5) + 0.5;
      }`,
      `#version 300 es
      precision highp float;

      in vec2 v_texcoord;
      out vec4 out_color;

      uniform sampler2D fg;
      uniform sampler2D bg;

      void main() {
        vec4 fg_color = texture(fg, v_texcoord);
        vec4 bg_color = texture(bg, v_texcoord);
        out_color = mix(fg_color, bg_color, bg_color.a);
      }`);



    this.extractShader.use();
    // texture units 0 and 1 for the image and mask
    this.extractShader.setUniform1i('u_image', 0);
    this.extractShader.setUniform1i('u_mask', 1);

    this.blendShader.use();
    // texture units 0 and 1 for the fg and bg
    this.blendShader.setUniform1i('fg', 0);
    this.blendShader.setUniform1i('bg', 1);
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

  drawOutputs(imageSource, newSegMap) {

    let start = performance.now();

    if (typeof newSegMap !== 'undefined') {
      this._segMap = newSegMap;
      let numOutputClasses = newSegMap.outputShape[2];
      this._mask = this._argmaxPerson(newSegMap.data, numOutputClasses);

      let scaledWidth = this._segMap.scaledShape[0];
      let scaledHeight = this._segMap.scaledShape[1];
      let outputWidth = this._segMap.outputShape[0];
      let outputHeight = this._segMap.outputShape[1];
      let isScaled = outputWidth === scaledWidth || outputHeight === scaledHeight;
  
      this._gl.canvas.width = scaledWidth * this._zoom;
      this._gl.canvas.height = scaledHeight * this._zoom;
      this._gl.viewport(0, 0, this._gl.canvas.width, this._gl.canvas.height);
      
      // upload new image texture
      this.imageTex = this._createAndBindTexture(this._gl.LINEAR);
      this._gl.texImage2D(
        this._gl.TEXTURE_2D,
        0,
        this._gl.RGBA,
        this._gl.RGBA,
        this._gl.UNSIGNED_BYTE,
        imageSource
      );
  
      // upload new mask texture
      this.maskTex = this._createAndBindTexture(this._gl.NEAREST);
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
      this._gl.pixelStorei(this._gl.UNPACK_ALIGNMENT, 1);
    }


    // feed image and mask into extract shader
    this.extractShader.use();
    this._gl.activeTexture(this._gl.TEXTURE0);
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this.extractFbo);
    this._gl.clear(this._gl.COLOR_BUFFER_BIT | this._gl.DEPTH_BUFFER_BIT);
    this._gl.bindTexture(this._gl.TEXTURE_2D, this.imageTex);
    this._gl.activeTexture(this._gl.TEXTURE1);
    this._gl.bindTexture(this._gl.TEXTURE_2D, this.maskTex);
    this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);


    if (this._effect == 'blur') {
      // feed extracted background into blur shader
      let kernel = [0.2270270270, 0.1945945946, 0.1216216216, 0.0540540541, 0.0162162162];
      this.blurShader.use();
      this.blurShader.setUniform1fv('kernel', kernel);

      this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this.blurFirstPassResultFbo);
      this._gl.clear(this._gl.COLOR_BUFFER_BIT | this._gl.DEPTH_BUFFER_BIT);
      this.blurShader.setUniform1i('firstpass', 1);
      this._gl.activeTexture(this._gl.TEXTURE0);
      this._gl.bindTexture(this._gl.TEXTURE_2D, this.bgTex);
      this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);

      this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this.styledBackgroundFbo);
      this._gl.clear(this._gl.COLOR_BUFFER_BIT | this._gl.DEPTH_BUFFER_BIT);
      this.blurShader.setUniform1i('firstpass', 0);
      // this._gl.activeTexture(this._gl.TEXTURE0);
      this._gl.bindTexture(this._gl.TEXTURE_2D, this.blurFirstPassResultTex);
      this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);
    } else {
      // feed extracted background into fill shader
      let fillColor = this._bgcolor.map(x => x / 255);
      this.fillShader.use();
      this.fillShader.setUniform4f('fill_color', ...fillColor, 1);
      this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this.styledBackgroundFbo);
      this._gl.clear(this._gl.COLOR_BUFFER_BIT | this._gl.DEPTH_BUFFER_BIT);
      this._gl.activeTexture(this._gl.TEXTURE0);
      this._gl.bindTexture(this._gl.TEXTURE_2D, this.bgTex);
      this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);
    }


    // feed into blend shader
    this.blendShader.use();
    this._gl.activeTexture(this._gl.TEXTURE0);
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);
    this._gl.clear(this._gl.COLOR_BUFFER_BIT | this._gl.DEPTH_BUFFER_BIT);
    this._gl.bindTexture(this._gl.TEXTURE_2D, this.fgTex);
    this._gl.activeTexture(this._gl.TEXTURE1);
    this._gl.bindTexture(this._gl.TEXTURE_2D, this.styledBgTex);
    this._gl.drawArrays(this._gl.TRIANGLES, 0, 6);

    console.log(`Draw time: ${(performance.now() - start).toFixed(2)} ms`);
  }


  // GL helper functions
  _createAndBindTexture(filter = this._gl.NEAREST) {
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

  _createAndBindFrameBuffer() {
    let fbo = this._gl.createFramebuffer();
    this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, fbo);
    return fbo;
  }
}


class Shader {
  constructor(gl, vertShaderSrc, fragShaderSrc) {
    this._gl = gl;
    let vs = this._createShader(this._gl.VERTEX_SHADER, vertShaderSrc);
    let fs = this._createShader(this._gl.FRAGMENT_SHADER, fragShaderSrc);
    this._prog = this._createProgram(vs, fs);
  }

  use() {
    this._gl.useProgram(this._prog);
  }

  setUniform1i(name, x) {
    this._gl.uniform1i(this._gl.getUniformLocation(this._prog, name), x);
  }

  setUniform4f(name, w, x, y, z) {
    this._gl.uniform4f(this._gl.getUniformLocation(this._prog, name), w, x, y, z);
  }

  setUniform1fv(name, arr) {
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