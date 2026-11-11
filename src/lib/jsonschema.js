'use strict';
// Validador mínimo de JSON Schema (subconjunto usado por los contratos de Día Uno):
// type, properties, required, additionalProperties:false, enum, const, anyOf, items,
// minLength, maxLength, minItems, maxItems. Sin dependencias. Devuelve la primera
// violación con su ruta, o null si el objeto es válido.

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);

function check(schema, v, path = '$') {
  if (!schema || typeof schema !== 'object') return null;
  if (schema.anyOf) {
    return schema.anyOf.some((s) => check(s, v, path) === null) ? null : `${path}: no coincide con ninguna alternativa`;
  }
  if ('const' in schema && v !== schema.const) return `${path}: debe ser ${JSON.stringify(schema.const)}`;
  if (schema.enum && !schema.enum.includes(v)) return `${path}: valor fuera de la lista`;
  if (schema.type) {
    const t = typeOf(v);
    const ok = Array.isArray(schema.type) ? schema.type.includes(t) || (t === 'integer' && schema.type.includes('number')) : schema.type === t || (schema.type === 'number' && t === 'integer');
    if (!ok) return `${path}: se esperaba ${schema.type}`;
  }
  if (typeof v === 'string') {
    if (schema.minLength !== undefined && v.length < schema.minLength) return `${path}: texto demasiado corto`;
    if (schema.maxLength !== undefined && v.length > schema.maxLength) return `${path}: texto demasiado largo`;
  }
  if (Array.isArray(v)) {
    if (schema.minItems !== undefined && v.length < schema.minItems) return `${path}: faltan elementos`;
    if (schema.maxItems !== undefined && v.length > schema.maxItems) return `${path}: demasiados elementos`;
    if (schema.items) {
      for (let i = 0; i < v.length; i++) {
        const e = check(schema.items, v[i], `${path}[${i}]`);
        if (e) return e;
      }
    }
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of schema.required || []) if (!(k in v)) return `${path}.${k}: falta`;
    if (schema.additionalProperties === false && schema.properties) {
      for (const k of Object.keys(v)) if (!(k in schema.properties)) return `${path}.${k}: propiedad no permitida`;
    }
    for (const [k, s] of Object.entries(schema.properties || {})) {
      if (k in v) {
        const e = check(s, v[k], `${path}.${k}`);
        if (e) return e;
      }
    }
  }
  return null;
}

/**
 * Copia del esquema apta para «structured outputs» estrictos de OpenAI: quita
 * palabras clave de longitud y cardinalidad y convierte const en enum. La validación
 * completa se hace igual en el servidor con `check`.
 */
function forStrictApi(schema) {
  const DROP = new Set(['$schema', '$id', 'minLength', 'maxLength', 'minItems', 'maxItems', 'title', 'description']);
  // `walk` recibe un esquema; los nombres dentro de `properties` son datos, no palabras clave.
  const walk = (s) => {
    if (Array.isArray(s)) return s.map(walk);
    if (!s || typeof s !== 'object') return s;
    const out = {};
    for (const [k, v] of Object.entries(s)) {
      if (DROP.has(k)) continue;
      if (k === 'properties') {
        out.properties = Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, walk(sub)]));
        continue;
      }
      if (k === 'const') {
        out.enum = [v];
        if (!s.type) out.type = typeof v;
        continue;
      }
      out[k] = walk(v);
    }
    // El modo estricto exige `type` también en los enums.
    if (out.enum && !out.type) out.type = typeof out.enum[0];
    return out;
  };
  return walk(schema);
}

module.exports = { check, forStrictApi };
