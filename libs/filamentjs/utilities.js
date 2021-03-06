/*
 * Copyright (C) 2018 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// ---------------
// Buffer Wrappers
// ---------------

// These wrappers make it easy for JavaScript clients to pass large swaths of data to Filament. They
// copy the contents of the given typed array into the WASM heap, then return a low-level buffer
// descriptor object. If the given array was taken from the WASM heap, then they create a temporary
// copy because the input pointer becomes invalidated after allocating heap memory for the buffer
// descriptor.

/// Buffer ::function:: Constructs a [BufferDescriptor] by copying a typed array into the WASM heap.
/// typedarray ::argument:: Data to consume (e.g. Uint8Array, Uint16Array, Float32Array)
/// ::retval:: [BufferDescriptor]
Filament.Buffer = function(typedarray) {
  console.assert(typedarray.buffer instanceof ArrayBuffer);
  console.assert(typedarray.byteLength > 0);
  if (Filament.HEAPU32.buffer == typedarray.buffer) {
    typedarray = new Uint8Array(typedarray);
  }
  const ta = typedarray;
  const bd = new Filament.driver$BufferDescriptor(ta);
  const uint8array = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  bd.getBytes().set(uint8array);
  return bd;
};

/// PixelBuffer ::function:: Constructs a [PixelBufferDescriptor] by copying a typed array into \
/// the WASM heap.
/// typedarray ::argument:: Data to consume (e.g. Uint8Array, Uint16Array, Float32Array)
/// format ::argument:: [PixelDataFormat]
/// datatype ::argument:: [PixelDataType]
/// ::retval:: [PixelBufferDescriptor]
Filament.PixelBuffer = function(typedarray, format, datatype) {
  console.assert(typedarray.buffer instanceof ArrayBuffer);
  console.assert(typedarray.byteLength > 0);
  if (Filament.HEAPU32.buffer == typedarray.buffer) {
    typedarray = new Uint8Array(typedarray);
  }
  const ta = typedarray;
  const bd = new Filament.driver$PixelBufferDescriptor(ta, format, datatype);
  const uint8array = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength);
  bd.getBytes().set(uint8array);
  return bd;
};

/// loadFilamesh ::function:: Consumes the contents of a filamesh file and creates a renderable.
/// engine ::argument:: [Engine]
/// typedarray ::argument:: Uint8Array with contents of filamesh file
/// definstance ::argument:: Optional default [MaterialInstance]
/// matinstances ::argument:: Optional object that gets populated with name => [MaterialInstance]
/// ::retval:: JavaScript object with keys `renderable`, `vertexBuffer`, and `indexBuffer`. \
/// These are of type [Entity], [VertexBuffer], and [IndexBuffer].
Filament.loadFilamesh = function(engine, typedarray, definstance, matinstances) {
    matinstances = matinstances || {};
    const registry = new Filament.MeshIO$MaterialRegistry();
    for (var key in matinstances) {
        registry.set(key, matinstances[key]);
    }
    if (definstance) {
        registry.set("DefaultMaterial", definstance);
    }
    const mesh = Filament.MeshIO.loadMeshFromBuffer(engine, Filament.Buffer(typedarray), registry);
    const keys = registry.keys();
    for (var i = 0; i < keys.size(); i++) {
        const key = keys.get(i);
        const minstance = registry.get(key);
        matinstances[key] = minstance;
    }
    return {
        "renderable": mesh.renderable(),
        "vertexBuffer": mesh.vertexBuffer(),
        "indexBuffer": mesh.indexBuffer(),
    }
}

// ------------------
// Geometry Utilities
// ------------------

/// IcoSphere ::class:: Utility class for constructing spheres (requires glMatrix).
///
/// The constructor takes an integer subdivision level, with 0 being an icosahedron.
///
/// Exposes three arrays as properties:
///
/// - `icosphere.vertices` Float32Array of XYZ coordinates.
/// - `icosphere.tangents` Uint16Array (interpreted as half-floats) encoding the surface orientation
/// as quaternions.
/// - `icosphere.triangles` Uint16Array with triangle indices.
///
Filament.IcoSphere = function(nsubdivs) {
  const X = .525731112119133606;
  const Z = .850650808352039932;
  const N = 0.;
  this.vertices = new Float32Array([
    -X, +N, +Z, +X, +N, +Z, -X, +N, -Z, +X, +N, -Z ,
    +N, +Z, +X, +N, +Z, -X, +N, -Z, +X, +N, -Z, -X ,
    +Z, +X, +N, -Z, +X, +N, +Z, -X, +N, -Z, -X, +N ,
  ]);
  this.triangles = new Uint16Array([
     1,   4, 0,  4,  9,  0, 4,   5, 9, 8, 5,   4 ,  1,  8,  4 ,
     1,  10, 8, 10,  3,  8, 8,   3, 5, 3, 2,   5 ,  3,  7,  2 ,
     3,  10, 7, 10,  6,  7, 6,  11, 7, 6, 0,  11 ,  6,  1,  0 ,
    10,   1, 6, 11,  0,  9, 2,  11, 9, 5, 2,   9 , 11,  2,  7 ,
  ]);
  if (nsubdivs) {
    while (nsubdivs-- > 0) {
      this.subdivide();
    }
  }
  const nverts = this.vertices.length / 3;
  this.tangents = new Uint16Array(4 * nverts);
  for (var i = 0; i < nverts; ++i) {
    const src = this.vertices.subarray(i * 3, i * 3 + 3);
    const dst = this.tangents.subarray(i * 4, i * 4 + 4);
    const n = vec3.normalize(vec3.create(), src);
    const b = vec3.cross(vec3.create(), n, [1, 0, 0]);
    const t = vec3.cross(vec3.create(), b, n);
    const q = quat.fromMat3(quat.create(), [t[0], t[1], t[2], b[0], b[1], b[2], n[0], n[1], n[2]]);
    vec4.packSnorm16(dst, q);
  }
}

Filament.IcoSphere.prototype.subdivide = function() {
  const srctris = this.triangles;
  const srcverts = this.vertices;
  const nsrctris = srctris.length / 3;
  const ndsttris = nsrctris * 4;
  const nsrcverts = srcverts.length / 3;
  const ndstverts = nsrcverts + nsrctris * 3;
  const dsttris = new Uint16Array(ndsttris * 3);
  const dstverts = new Float32Array(ndstverts * 3);
  dstverts.set(srcverts);
  var srcind = 0, dstind = 0, i3 = nsrcverts * 3, i4 = i3 + 3, i5 = i4 + 3;
  for (var tri = 0; tri < nsrctris; tri++, i3 += 9, i4 += 9, i5 += 9) {
    const i0 = srctris[srcind++] * 3;
    const i1 = srctris[srcind++] * 3;
    const i2 = srctris[srcind++] * 3;
    const v0 = srcverts.subarray(i0, i0 + 3);
    const v1 = srcverts.subarray(i1, i1 + 3);
    const v2 = srcverts.subarray(i2, i2 + 3);
    const v3 = dstverts.subarray(i3, i3 + 3);
    const v4 = dstverts.subarray(i4, i4 + 3);
    const v5 = dstverts.subarray(i5, i5 + 3);
    vec3.normalize(v3, vec3.add(v3, v0, v1));
    vec3.normalize(v4, vec3.add(v4, v1, v2));
    vec3.normalize(v5, vec3.add(v5, v2, v0));
    dsttris[dstind++] = i0 / 3;
    dsttris[dstind++] = i3 / 3;
    dsttris[dstind++] = i5 / 3;
    dsttris[dstind++] = i3 / 3;
    dsttris[dstind++] = i1 / 3;
    dsttris[dstind++] = i4 / 3;
    dsttris[dstind++] = i5 / 3;
    dsttris[dstind++] = i3 / 3;
    dsttris[dstind++] = i4 / 3;
    dsttris[dstind++] = i2 / 3;
    dsttris[dstind++] = i5 / 3;
    dsttris[dstind++] = i4 / 3;
  }
  this.triangles = dsttris;
  this.vertices = dstverts;
}

// ---------------
// Math Extensions
// ---------------

function clamp(v, least, most) {
  return Math.max(Math.min(most, v), least);
}

/// packSnorm16 ::function:: Converts a float in [-1, +1] into a half-float.
/// value ::argument:: float
/// ::retval:: half-float
Filament.packSnorm16 = function(value) {
  return Math.round(clamp(value, -1.0, 1.0) * 32767.0);
}

/// loadMathExtensions ::function:: Extends the [glMatrix](http://glmatrix.net/) math library.
/// Filament does not require its clients to use glMatrix, but if its usage is detected then
/// the [init] function will automatically call `loadMathExtensions`.
/// This defines the following functions:
/// - **vec4.packSnorm16** can be used to create half-floats (see [packSnorm16])
/// - **mat3.fromRotation** now takes an arbitrary axis
Filament.loadMathExtensions = function() {
  vec4.packSnorm16 = function(out, src) {
    out[0] = Filament.packSnorm16(src[0]);
    out[1] = Filament.packSnorm16(src[1]);
    out[2] = Filament.packSnorm16(src[2]);
    out[3] = Filament.packSnorm16(src[3]);
    return out;
  }
  // In gl-matrix, mat3 rotation assumes rotation about the Z axis, so here we add a function
  // to allow an arbitrary axis.
  const fromRotationZ = mat3.fromRotation;
  mat3.fromRotation = function(out, radians, axis) {
    if (axis) {
      return mat3.fromMat4(out, mat4.fromRotation(mat4.create(), radians, axis));
    }
    return fromRotationZ(out, radians);
  };
};

// ---------------
// Texture helpers
// ---------------

/// createTextureFromKtx ::function:: Utility function that creates a [Texture] from a KTX file.
/// ktxdata ::argument:: Uint8Array with the contents of a KTX file.
/// engine ::argument:: [Engine]
/// options ::argument:: Options dictionary. For now, the `rgbm` boolean is the only option.
/// ::retval:: [Texture]
Filament.createTextureFromKtx = function(ktxdata, engine, options) {
  options = options || {};

  const Sampler = Filament.Texture$Sampler;
  const TextureFormat = Filament.Texture$InternalFormat;
  const PixelDataFormat = Filament.PixelDataFormat;
  const gl = Filament.ctx;

  const ktx = options['ktx'] || new Filament.KtxBundle(Filament.Buffer(ktxdata));
  const nlevels = ktx.getNumMipLevels();
  const ktxformat = ktx.info().glInternalFormat;
  const rgbm = !!options['rgbm'];

  // TODO: this switch is incomplete. Can the KtxBundle class assist?
  var texformat, pbformat, pbtype;
  switch (ktxformat) {
    case gl.RGB:
      texformat = TextureFormat.RGB8;
      pbformat = PixelDataFormat.RGB;
      pbtype = Filament.PixelDataType.UBYTE;
      break;
    case gl.RGBA:
      texformat = TextureFormat.RGBA8;
      pbformat = rgbm ? PixelDataFormat.RGBM : PixelDataFormat.RGBA;
      pbtype = Filament.PixelDataType.UBYTE;
      break;
    default:
      console.error('Unsupported KTX format.');
      return null;
  }

  const tex = Filament.Texture.Builder()
    .width(ktx.info().pixelWidth)
    .height(ktx.info().pixelHeight)
    .levels(nlevels)
    .sampler(ktx.isCubemap() ? Sampler.SAMPLER_CUBEMAP : Sampler.SAMPLER_2D)
    .format(texformat)
    .rgbm(rgbm)
    .build(engine);

  if (ktx.isCubemap()) {
    for (var level = 0; level < nlevels; level++) {
      const uint8array = ktx.getCubeBlob(level).getBytes();
      const pixelbuffer = Filament.PixelBuffer(uint8array, pbformat, pbtype);
      tex.setImageCube(engine, level, pixelbuffer);
    }
  } else {
    for (var level = 0; level < nlevels; level++) {
      const uint8array = ktx.getBlob([level, 0, 0]).getBytes();
      const pixelbuffer = Filament.PixelBuffer(uint8array, pbformat, pbtype);
      tex.setImage(engine, level, pixelbuffer);
    }
  }

  return tex;
};

/// createIblFromKtx ::function:: Utility function that creates an [IndirectLight] from a KTX file.
/// ktxdata ::argument:: Uint8Array with the contents of a KTX file.
/// engine ::argument:: [Engine]
/// options ::argument:: Options dictionary. For now, the `rgbm` boolean is the only option.
/// ::retval:: [IndirectLight]
Filament.createIblFromKtx = function(ktxdata, engine, options) {
  options = options || {};
  const iblktx = options['ktx'] = new Filament.KtxBundle(Filament.Buffer(ktxdata));
  const ibltex = Filament.createTextureFromKtx(ktxdata, engine, options);
  const shstring = iblktx.getMetadata("sh");
  const shfloats = shstring.split(/\s/, 9 * 3).map(parseFloat);
  return Filament.IndirectLight.Builder()
    .reflections(ibltex)
    .irradianceSh(3, shfloats)
    .build(engine);
};

/// createTextureFromPng ::function:: Creates a 2D [Texture] from the raw contents of a PNG file.
/// pngdata ::argument:: Uint8Array with the contents of a PNG file.
/// engine ::argument:: [Engine]
/// options ::argument:: JavaScript object with optional `rgbm`, `noalpha`, and `nomips` keys.
/// ::retval:: [Texture]
Filament.createTextureFromPng = function(pngdata, engine, options) {
  const Sampler = Filament.Texture$Sampler;
  const TextureFormat = Filament.Texture$InternalFormat;
  const PixelDataFormat = Filament.PixelDataFormat;

  options = options || {};
  const rgbm = !!options['rgbm'];
  const noalpha = !!options['noalpha'];
  const nomips = !!options['nomips'];

  const decodedpng = Filament.decodePng(Filament.Buffer(pngdata), noalpha ? 3 : 4);

  var texformat, pbformat, pbtype;
  if (noalpha) {
    texformat = TextureFormat.RGB8;
    pbformat = PixelDataFormat.RGB;
    pbtype = Filament.PixelDataType.UBYTE;
  } else {
    texformat = TextureFormat.RGBA8;
    pbformat = rgbm ? PixelDataFormat.RGBM : PixelDataFormat.RGBA;
    pbtype = Filament.PixelDataType.UBYTE;
  }

  const tex = Filament.Texture.Builder()
    .width(decodedpng.width)
    .height(decodedpng.height)
    .levels(nomips ? 1 : 0xff)
    .sampler(Sampler.SAMPLER_2D)
    .format(texformat)
    .rgbm(rgbm)
    .build(engine);

  const pixelbuffer = Filament.PixelBuffer(decodedpng.data.getBytes(), pbformat, pbtype);
  tex.setImage(engine, 0, pixelbuffer);
  if (!nomips) {
    tex.generateMipmaps(engine);
  }
  return tex;
};
