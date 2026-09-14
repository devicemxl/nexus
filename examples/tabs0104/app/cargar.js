/**
 * Carga de recursos externos.
 *
 * Un solo sitio donde una respuesta no-OK se convierte en error. Sin esto
 * cada `fetch` decide por su cuenta si un 404 es un fallo o un texto vacío,
 * que es el mismo problema que `zonas()` resolvió para el DOM.
 */

async function traer(url) {
  const respuesta = await fetch(url);
  if (!respuesta.ok) {
    throw new Error(`${url}: ${respuesta.status} ${respuesta.statusText}`);
  }
  return respuesta;
}

export async function traerTexto(url) {
  return (await traer(url)).text();
}

export async function traerJson(url) {
  return (await traer(url)).json();
}
