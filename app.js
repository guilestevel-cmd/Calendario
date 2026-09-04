/* =============================================================
   PLANEA — configuración
   Pega aquí la URL /exec que te dio Apps Script al implementar
   Code.gs como aplicación web.
   ============================================================= */
const URL_API = 'https://script.google.com/macros/s/AKfycbyXSOthf8ckGUBBXy4mFNjYKL7xaVZkzx8cIS6Zhkkptlvu9-DLb4YLR1DoE7XUv-m8lQ/exec';

/* ============================== constantes ============================== */

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS_CORTOS = ['Lu','Ma','Mi','Ju','Vi','Sa','Do'];
const DIAS_LARGOS = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
const ROLES = {
  admin:    { label: 'Administración', icono: 'landmark' },
  comision: { label: 'Comisión',       icono: 'users' },
  profesor: { label: 'Profesor',       icono: 'graduation-cap' },
};
const TIPO_FIJO_POR_ROL = { comision: 'evento', profesor: 'tarea', admin: null };

/* ============================== estado global ============================== */

const estado = {
  cargando: true,
  sesion: null,
  unidades: [],
  actividades: [],
  configuracion: { nombreColegio: 'Instituto de Educación Media' },
  vista: 'calendario',
  unidadActivaId: null,
  unidadReporteId: null,
  mesActual: null,
  diaSeleccionado: null,
  formAbierto: false,
  formUnidadAbierto: false,
  confirmar: null,
};
let unidadEnEdicion = null;
let rolAccesoSeleccionado = 'profesor';

try {
  const guardada = localStorage.getItem('planea-sesion');
  if (guardada) estado.sesion = JSON.parse(guardada);
} catch (e) {}

/* ============================== utilidades =============================== */

function pad(n) { return String(n).padStart(2, '0'); }
function formatFecha(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseFecha(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function formatFechaLarga(s) {
  const d = parseFecha(s);
  return `${DIAS_LARGOS[(d.getDay() + 6) % 7]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}
function formatFechaCorta(s) {
  const d = parseFecha(s);
  return `${d.getDate()} de ${MESES[d.getMonth()].slice(0, 3)}`;
}
function hoyStr() { return formatFecha(new Date()); }
function cx(...clases) { return clases.filter(Boolean).join(' '); }
function generarId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
function esc(s) {
  if (s === undefined || s === null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function mensajeError(texto) { return `<p class="texto-error">${esc(texto)}</p>`; }

function getMatrizMes(year, month) {
  const primerDia = new Date(year, month, 1);
  const diasEnMes = new Date(year, month + 1, 0).getDate();
  const offset = (primerDia.getDay() + 6) % 7;
  const celdas = [];
  for (let i = 0; i < offset; i++) celdas.push(null);
  for (let d = 1; d <= diasEnMes; d++) celdas.push(new Date(year, month, d));
  while (celdas.length % 7 !== 0) celdas.push(null);
  const semanas = [];
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
  return semanas;
}
function enRango(d, fechaInicio, fechaFin) {
  const t = formatFecha(d);
  return t >= fechaInicio && t <= fechaFin;
}
function getEstadoDia(fechaStr, actividades) {
  const delDia = actividades.filter(a => a.fecha === fechaStr);
  const eventos = delDia.filter(a => a.tipo === 'evento');
  const tareas = delDia.filter(a => a.tipo === 'tarea');
  const tieneEvento = eventos.length > 0;
  const capacidad = tieneEvento ? 2 : 5;
  const ocupadas = tareas.length;
  const disponibles = Math.max(capacidad - ocupadas, 0);
  let esta = 'libre';
  if (ocupadas >= capacidad) esta = 'lleno';
  else if (ocupadas >= Math.ceil(capacidad / 2)) esta = 'medio';
  return { delDia, eventos, tareas, tieneEvento, capacidad, ocupadas, disponibles, estado: esta };
}
function puedeAgregar(tipo, estadoDia) {
  if (tipo === 'evento') {
    if (estadoDia.tieneEvento) return { ok: false, msg: 'Este día ya tiene un evento de comisión asignado.' };
    if (estadoDia.tareas.length > 2) return { ok: false, msg: 'Este día ya tiene más de 2 tareas asignadas, así que no admite un evento de comisión.' };
    return { ok: true };
  }
  if (estadoDia.ocupadas >= estadoDia.capacidad) {
    return { ok: false, msg: `Este día alcanzó el máximo de ${estadoDia.capacidad} actividades de entrega.` };
  }
  return { ok: true };
}
function unidadActiva() { return estado.unidades.find(u => u.id === estado.unidadActivaId) || null; }
function actividadesUnidadActual() { return estado.actividades.filter(a => a.unidadId === estado.unidadActivaId); }
function unidadesOrdenadas() { return [...estado.unidades].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio)); }

/* ============================== conexión a la API =============================== */

async function api(recurso, opciones) {
  opciones = opciones || {};
  if (opciones.metodo === 'POST') {
    const resp = await fetch(URL_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ recurso, accion: opciones.accion, datos: opciones.datos }),
    });
    return resp.json();
  }
  const resp = await fetch(`${URL_API}?recurso=${encodeURIComponent(recurso)}`);
  return resp.json();
}

function mostrarErrorConexion() {
  if (document.getElementById('franja-error-conexion')) return;
  const raiz = document.getElementById('app');
  const franja = document.createElement('div');
  franja.id = 'franja-error-conexion';
  franja.className = 'franja-aviso';
  franja.textContent = 'No se pudo conectar con la base de datos. Revisa tu conexión a internet o la URL_API configurada en app.js.';
  raiz.prepend(franja);
}

async function iniciar() {
  if (!URL_API || URL_API.includes('https://script.google.com/macros/s/AKfycbyXSOthf8ckGUBBXy4mFNjYKL7xaVZkzx8cIS6Zhkkptlvu9-DLb4YLR1DoE7XUv-m8lQ/exec')) {
    document.getElementById('app').innerHTML = plantillaConfigPendiente();
    return;
  }
  render();
  try {
    const [unidades, actividades, configuracion] = await Promise.all([
      api('unidades'), api('actividades'), api('configuracion'),
    ]);
    estado.unidades = Array.isArray(unidades) ? unidades : [];
    estado.actividades = Array.isArray(actividades) ? actividades : [];
    estado.configuracion = Object.assign({ nombreColegio: 'Instituto de Educación Media' }, configuracion || {});
    if (estado.unidades.length) {
      const primera = unidadesOrdenadas()[0];
      estado.unidadActivaId = primera.id;
      const di = parseFecha(primera.fechaInicio);
      estado.mesActual = { year: di.getFullYear(), month: di.getMonth() };
    } else {
      const n = new Date();
      estado.mesActual = { year: n.getFullYear(), month: n.getMonth() };
    }
  } catch (e) {
    mostrarErrorConexion();
  } finally {
    estado.cargando = false;
    render();
  }
}

/* ============================== acciones de sesión =============================== */

function elegirRolAcceso(rol) {
  rolAccesoSeleccionado = rol;
  document.querySelectorAll('.opcion-rol').forEach(btn => {
    btn.classList.toggle('opcion-rol-activa', btn.dataset.rol === rol);
  });
}
function enviarAcceso(ev) {
  ev.preventDefault();
  const nombre = document.getElementById('campo-nombre-acceso').value.trim();
  const errorEl = document.getElementById('error-acceso');
  if (!nombre) { errorEl.innerHTML = mensajeError('Escribe tu nombre para continuar.'); return; }
  estado.sesion = { rol: rolAccesoSeleccionado, nombre };
  try { localStorage.setItem('planea-sesion', JSON.stringify(estado.sesion)); } catch (e) {}
  render();
}
function cerrarSesion() {
  estado.sesion = null;
  try { localStorage.removeItem('planea-sesion'); } catch (e) {}
  render();
}
function cambiarVista(v) { estado.vista = v; render(); }

/* ============================== acciones de unidades =============================== */

function seleccionarUnidadActiva(id) {
  estado.unidadActivaId = id;
  const u = estado.unidades.find(x => x.id === id);
  if (u) { const di = parseFecha(u.fechaInicio); estado.mesActual = { year: di.getFullYear(), month: di.getMonth() }; }
  estado.vista = 'calendario';
  render();
}
function abrirFormUnidad(id) {
  unidadEnEdicion = id ? estado.unidades.find(u => u.id === id) : null;
  estado.formUnidadAbierto = true;
  render();
}
function cerrarFormUnidad() {
  estado.formUnidadAbierto = false;
  unidadEnEdicion = null;
  render();
}
async function manejarEnvioUnidad(ev) {
  ev.preventDefault();
  const nombre = document.getElementById('campo-nombre-unidad').value.trim();
  const fechaInicio = document.getElementById('campo-fecha-inicio-unidad').value;
  const fechaFin = document.getElementById('campo-fecha-fin-unidad').value;
  const errorEl = document.getElementById('error-form-unidad');
  if (!nombre) { errorEl.innerHTML = mensajeError('Escribe un nombre para la unidad.'); return; }
  if (!fechaInicio || !fechaFin) { errorEl.innerHTML = mensajeError('Indica la fecha de inicio y la fecha de fin.'); return; }
  if (fechaFin < fechaInicio) { errorEl.innerHTML = mensajeError('La fecha de fin no puede ser anterior a la de inicio.'); return; }

  const boton = document.getElementById('boton-guardar-unidad');
  if (boton) boton.disabled = true;
  try {
    if (unidadEnEdicion) {
      const resultado = await api('unidades', { metodo: 'POST', accion: 'editar', datos: { id: unidadEnEdicion.id, nombre, fechaInicio, fechaFin } });
      estado.unidades = resultado.lista || estado.unidades;
    } else {
      const nueva = { id: generarId(), nombre, fechaInicio, fechaFin };
      const resultado = await api('unidades', { metodo: 'POST', accion: 'crear', datos: nueva });
      estado.unidades = resultado.lista || estado.unidades;
      if (!estado.unidadActivaId) {
        estado.unidadActivaId = nueva.id;
        const di = parseFecha(nueva.fechaInicio);
        estado.mesActual = { year: di.getFullYear(), month: di.getMonth() };
      }
    }
    estado.formUnidadAbierto = false;
    unidadEnEdicion = null;
    render();
  } catch (e) {
    errorEl.innerHTML = mensajeError('No se pudo guardar. Revisa tu conexión e intenta de nuevo.');
    if (boton) boton.disabled = false;
  }
}
function pedirConfirmarEliminarUnidad(id) {
  const u = estado.unidades.find(x => x.id === id);
  if (!u) return;
  const total = estado.actividades.filter(a => a.unidadId === id).length;
  estado.confirmar = {
    mensaje: `¿Eliminar la unidad "${u.nombre}"? También se eliminarán sus ${total} actividades.`,
    accion: async () => {
      const resultado = await api('unidades', { metodo: 'POST', accion: 'eliminar', datos: { id } });
      estado.unidades = resultado.lista || [];
      estado.actividades = await api('actividades');
      if (estado.unidadActivaId === id) estado.unidadActivaId = null;
    },
  };
  render();
}

/* ============================== acciones de actividades =============================== */

function abrirDia(fecha) {
  estado.diaSeleccionado = fecha;
  estado.formAbierto = false;
  render();
}
function cerrarDia() {
  estado.diaSeleccionado = null;
  estado.formAbierto = false;
  render();
}
function mostrarFormActividad() {
  estado.formAbierto = true;
  render();
}
function ocultarFormActividad() {
  estado.formAbierto = false;
  render();
}
function alternarTipoActividad(tipo) {
  document.getElementById('campo-tipo').value = tipo;
  document.getElementById('btn-tipo-evento').classList.toggle('opcion-tipo-activa', tipo === 'evento');
  document.getElementById('btn-tipo-tarea').classList.toggle('opcion-tipo-activa', tipo === 'tarea');
  document.getElementById('bloque-campos-tarea').style.display = tipo === 'tarea' ? '' : 'none';
  actualizarAvisoCupoForm(tipo);
}
function actualizarAvisoCupoForm(tipo) {
  const estadoDia = getEstadoDia(estado.diaSeleccionado, actividadesUnidadActual());
  const chequeo = puedeAgregar(tipo, estadoDia);
  const contenedor = document.getElementById('aviso-cupo-form');
  const boton = document.getElementById('boton-guardar-actividad');
  if (!contenedor) return;
  contenedor.innerHTML = chequeo.ok ? '' : mensajeError(chequeo.msg);
  if (boton) boton.disabled = !chequeo.ok;
}
async function manejarEnvioActividad(ev) {
  ev.preventDefault();
  const tipo = document.getElementById('campo-tipo').value;
  const titulo = document.getElementById('campo-titulo-actividad').value.trim();
  const materia = tipo === 'tarea' ? document.getElementById('campo-materia').value.trim() : '';
  const curso = tipo === 'tarea' ? document.getElementById('campo-curso').value.trim() : '';
  const descripcion = document.getElementById('campo-descripcion-actividad').value.trim();
  const errorEl = document.getElementById('error-form-actividad');

  if (!titulo) { errorEl.innerHTML = mensajeError('Escribe un título para la actividad.'); return; }
  const estadoDia = getEstadoDia(estado.diaSeleccionado, actividadesUnidadActual());
  const chequeo = puedeAgregar(tipo, estadoDia);
  if (!chequeo.ok) { errorEl.innerHTML = mensajeError(chequeo.msg); return; }

  const boton = document.getElementById('boton-guardar-actividad');
  if (boton) boton.disabled = true;
  try {
    const nueva = {
      id: generarId(), unidadId: estado.unidadActivaId, fecha: estado.diaSeleccionado,
      tipo, titulo, descripcion, materia, curso,
      rol: estado.sesion.rol, responsable: estado.sesion.nombre, creadoEn: Date.now(),
    };
    const resultado = await api('actividades', { metodo: 'POST', accion: 'crear', datos: nueva });
    estado.actividades = resultado.lista || estado.actividades;
    estado.formAbierto = false;
    render();
  } catch (e) {
    errorEl.innerHTML = mensajeError('No se pudo guardar. Revisa tu conexión e intenta de nuevo.');
    if (boton) boton.disabled = false;
  }
}
function puedeEliminarActividad(a) { return estado.sesion.rol === 'admin' || a.rol === estado.sesion.rol; }
function pedirConfirmarEliminarActividad(id) {
  const a = estado.actividades.find(x => x.id === id);
  if (!a) return;
  estado.confirmar = {
    mensaje: `¿Eliminar "${a.titulo}"?`,
    accion: async () => {
      const resultado = await api('actividades', { metodo: 'POST', accion: 'eliminar', datos: { id } });
      estado.actividades = resultado.lista || estado.actividades;
    },
  };
  render();
}

/* ============================== confirmación genérica =============================== */

async function ejecutarConfirmacion() {
  const c = estado.confirmar;
  if (!c) return;
  estado.confirmar = null;
  try { await c.accion(); } catch (e) { mostrarErrorConexion(); }
  render();
}
function cancelarConfirmacion() { estado.confirmar = null; render(); }

/* ============================== reporte =============================== */

function cambiarUnidadReporte(id) { estado.unidadReporteId = id; render(); }
function actualizarNombreColegioEnPantalla(valor) {
  const el = document.getElementById('reporte-colegio-texto');
  if (el) el.textContent = valor || 'Establecimiento educativo';
}
async function guardarNombreColegio(input) {
  const valor = input.value.trim();
  estado.configuracion.nombreColegio = valor;
  try { await api('configuracion', { metodo: 'POST', datos: { nombreColegio: valor } }); } catch (e) {}
}

/* ============================== render principal =============================== */

function render() {
  const raiz = document.getElementById('app');
  if (estado.cargando) { raiz.innerHTML = plantillaCarga(); return; }
  if (!estado.sesion) { raiz.innerHTML = plantillaAcceso(); crearIconos(); return; }
  raiz.innerHTML = plantillaApp();
  crearIconos();
}
function crearIconos() { if (window.lucide) lucide.createIcons(); }

function plantillaCarga() {
  return `<div class="pantalla-carga"><i data-lucide="loader-2" class="girando" style="width:28px;height:28px"></i><p>Cargando el planeador…</p></div>`;
}
function plantillaConfigPendiente() {
  return `
    <div class="pantalla-config">
      <i data-lucide="settings" style="width:30px;height:30px"></i>
      <h2 style="font-family:'Fraunces',serif;color:#0f2b27;">Falta conectar la base de datos</h2>
      <p style="max-width:420px;color:#52655f;font-size:14px;line-height:1.6;">
        Abre <code>app.js</code>, busca la constante <code>URL_API</code> al inicio del archivo,
        y pega ahí la URL /exec de tu aplicación web de Apps Script. Luego vuelve a subir el archivo a GitHub.
      </p>
    </div>`;
}

/* ---------- acceso ---------- */
function plantillaAcceso() {
  const opciones = Object.entries(ROLES).map(([clave, r]) => `
    <button type="button" class="opcion-rol${clave === rolAccesoSeleccionado ? ' opcion-rol-activa' : ''}" data-rol="${clave}" onclick="elegirRolAcceso('${clave}')">
      <i data-lucide="${r.icono}"></i>
      <span>${r.label}</span>
    </button>`).join('');

  return `
    <div class="acceso">
      <div class="acceso-tarjeta">
        <div class="acceso-marca"><i data-lucide="calendar-days"></i><span>Planea</span></div>
        <h1>El plan de actividades de la unidad, en un solo calendario</h1>
        <p class="acceso-sub">Dirección, comisiones y profesores colocan eventos y fechas de entrega en un mismo calendario, respetando el cupo de cada día, para entregar a los estudiantes un plan claro por unidad.</p>
        <form class="acceso-form" onsubmit="enviarAcceso(event)">
          <label class="etiqueta">Tu nombre</label>
          <input class="campo" id="campo-nombre-acceso" placeholder="Ej. Ana López">
          <label class="etiqueta">Tu rol en el establecimiento</label>
          <div class="selector-roles">${opciones}</div>
          <div id="error-acceso"></div>
          <button type="submit" class="boton boton-primario boton-ancho">Entrar al planeador</button>
        </form>
        <p class="acceso-nota">El calendario y las unidades se comparten entre todas las personas que usan esta aplicación. El rol organiza qué puede agregar cada quien; no es una contraseña.</p>
      </div>
    </div>`;
}

/* ---------- app shell ---------- */
function plantillaApp() {
  return `
    <div class="cascaron">
      ${plantillaBarra()}
      <main class="contenido">
        ${estado.vista === 'calendario' ? plantillaCalendario() : ''}
        ${estado.vista === 'unidades' ? plantillaUnidades() : ''}
        ${estado.vista === 'reporte' ? plantillaReporte() : ''}
      </main>
    </div>
    ${estado.diaSeleccionado ? plantillaPanelDia() : ''}
    ${estado.confirmar ? plantillaConfirmar() : ''}
  `;
}
function plantillaBarra() {
  const rol = ROLES[estado.sesion.rol];
  const items = [
    { clave: 'calendario', label: 'Calendario', icono: 'calendar-days' },
    { clave: 'unidades', label: 'Unidades', icono: 'book-open' },
    { clave: 'reporte', label: 'Reporte', icono: 'printer' },
  ];
  return `
    <aside class="barra no-imprimir">
      <div class="barra-marca"><i data-lucide="calendar-days"></i><span>Planea</span></div>
      <nav class="barra-nav">
        ${items.map(it => `
          <button class="barra-item${estado.vista === it.clave ? ' barra-item-activo' : ''}" onclick="cambiarVista('${it.clave}')">
            <i data-lucide="${it.icono}"></i><span>${it.label}</span>
          </button>`).join('')}
      </nav>
      <div class="barra-usuario">
        <div class="barra-usuario-info">
          <i data-lucide="${rol.icono}"></i>
          <div>
            <p class="barra-usuario-nombre">${esc(estado.sesion.nombre)}</p>
            <p class="barra-usuario-rol">${rol.label}</p>
          </div>
        </div>
        <button class="barra-salir" onclick="cerrarSesion()" title="Cambiar de rol"><i data-lucide="log-out"></i></button>
      </div>
    </aside>`;
}

/* ---------- calendario ---------- */
function plantillaCalendario() {
  if (!estado.unidades.length) {
    return plantillaEstadoVacio(
      'Aún no hay unidades creadas',
      estado.sesion.rol === 'admin' ? 'Crea la primera unidad con su fecha de inicio y fin para empezar a planear el calendario.' : 'Pide a Administración que cree la primera unidad para poder ver el calendario.',
      estado.sesion.rol === 'admin' ? `<button class="boton boton-primario" onclick="cambiarVista('unidades')">Crear unidad</button>` : ''
    );
  }
  const unidad = unidadActiva();
  if (!unidad) {
    return plantillaEstadoVacio('Elige una unidad', 'Selecciona una unidad para ver y planear su calendario.', `<button class="boton boton-primario" onclick="cambiarVista('unidades')">Ver unidades</button>`);
  }

  const inicio = parseFecha(unidad.fechaInicio);
  const fin = parseFecha(unidad.fechaFin);
  const limiteAnterior = inicio.getFullYear() * 12 + inicio.getMonth();
  const limiteSiguiente = fin.getFullYear() * 12 + fin.getMonth();
  const actual = estado.mesActual.year * 12 + estado.mesActual.month;
  const semanas = getMatrizMes(estado.mesActual.year, estado.mesActual.month);
  const hoy = hoyStr();
  const actividadesUnidad = actividadesUnidadActual();

  const opcionesUnidad = unidadesOrdenadas().map(u => `<option value="${u.id}"${u.id === unidad.id ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('');

  const filas = semanas.map(semana => `
    <div class="fila-semana">
      ${semana.map(d => {
        if (!d) return `<div class="celda-vacia"></div>`;
        const fechaStr = formatFecha(d);
        const activo = enRango(d, unidad.fechaInicio, unidad.fechaFin);
        if (!activo) return `<div class="celda-dia celda-inactiva"><span class="numero-dia">${d.getDate()}</span></div>`;
        const info = getEstadoDia(fechaStr, actividadesUnidad);
        return `
          <button class="celda-dia celda-${info.estado}${fechaStr === hoy ? ' celda-hoy' : ''}" onclick="abrirDia('${fechaStr}')">
            ${info.tieneEvento ? `<i data-lucide="flag" class="marca-evento" style="width:11px;height:11px"></i>` : ''}
            <span class="numero-dia">${d.getDate()}</span>
            ${(info.ocupadas > 0 || info.tieneEvento) ? `<span class="conteo-dia">${info.ocupadas}/${info.capacidad}</span>` : ''}
          </button>`;
      }).join('')}
    </div>`).join('');

  return `
    <div class="vista">
      <div class="vista-encabezado">
        <div>
          <label class="etiqueta-inline">Unidad</label>
          <select class="selector" onchange="seleccionarUnidadActiva(this.value)">${opcionesUnidad}</select>
          <p class="rango-unidad">${formatFechaCorta(unidad.fechaInicio)} — ${formatFechaCorta(unidad.fechaFin)}</p>
        </div>
        <div class="nav-mes">
          <button class="boton-icono" onclick="cambiarMes(-1)"${actual <= limiteAnterior ? ' disabled' : ''}><i data-lucide="chevron-left"></i></button>
          <span class="nombre-mes">${MESES[estado.mesActual.month]} ${estado.mesActual.year}</span>
          <button class="boton-icono" onclick="cambiarMes(1)"${actual >= limiteSiguiente ? ' disabled' : ''}><i data-lucide="chevron-right"></i></button>
        </div>
      </div>

      <div class="tarjeta calendario-tarjeta">
        <div class="fila-dias-semana">${DIAS_CORTOS.map(d => `<div class="etiqueta-dia-semana">${d}</div>`).join('')}</div>
        ${filas}
      </div>

      <div class="leyenda">
        <span class="leyenda-item"><i class="punto punto-libre"></i>Disponible</span>
        <span class="leyenda-item"><i class="punto punto-medio"></i>Media disponibilidad</span>
        <span class="leyenda-item"><i class="punto punto-lleno"></i>Lleno</span>
        <span class="leyenda-item"><i data-lucide="flag" style="width:12px;height:12px"></i>Día con evento de comisión</span>
      </div>
      <p class="nota-reglas">Un día con evento de comisión admite hasta 2 tareas. Un día normal admite hasta 5 actividades.</p>
    </div>`;
}
function cambiarMes(delta) {
  const total = estado.mesActual.year * 12 + estado.mesActual.month + delta;
  estado.mesActual = { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
  render();
}

/* ---------- panel del día ---------- */
function plantillaPanelDia() {
  const estadoDia = getEstadoDia(estado.diaSeleccionado, actividadesUnidadActual());
  const tipoFijo = TIPO_FIJO_POR_ROL[estado.sesion.rol];
  const items = [...estadoDia.eventos, ...estadoDia.tareas];

  const itemsHtml = items.map(a => `
    <div class="item-actividad ${a.tipo === 'evento' ? 'item-evento' : 'item-tarea'}">
      <div class="item-icono"><i data-lucide="${a.tipo === 'evento' ? 'flag' : 'book-open'}" style="width:15px;height:15px"></i></div>
      <div class="item-cuerpo">
        <p class="item-titulo">${esc(a.titulo)}</p>
        ${a.tipo === 'tarea' && (a.materia || a.curso) ? `<p class="item-meta">${esc([a.materia, a.curso].filter(Boolean).join(' · '))}</p>` : ''}
        ${a.descripcion ? `<p class="item-descripcion">${esc(a.descripcion)}</p>` : ''}
        <p class="item-responsable">${ROLES[a.rol] ? ROLES[a.rol].label : esc(a.rol)} · ${esc(a.responsable)}</p>
      </div>
      ${puedeEliminarActividad(a) ? `<button class="item-eliminar" onclick="pedirConfirmarEliminarActividad('${a.id}')" title="Eliminar"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>` : ''}
    </div>`).join('');

  let cuerpoAgregar;
  if (estado.formAbierto) {
    cuerpoAgregar = plantillaFormActividad(tipoFijo, estadoDia);
  } else {
    const tipoParaChequear = tipoFijo || (puedeAgregar('evento', estadoDia).ok ? 'evento' : 'tarea');
    const chequeo = tipoFijo ? puedeAgregar(tipoFijo, estadoDia) : { ok: puedeAgregar('evento', estadoDia).ok || puedeAgregar('tarea', estadoDia).ok };
    if (chequeo.ok) {
      const etiquetaBoton = tipoFijo === 'evento' ? 'evento' : tipoFijo === 'tarea' ? 'tarea' : 'actividad';
      cuerpoAgregar = `<button class="boton boton-secundario boton-ancho" onclick="mostrarFormActividad()"><i data-lucide="plus" style="width:16px;height:16px"></i> Agregar ${etiquetaBoton}</button>`;
    } else {
      const msg = tipoFijo ? puedeAgregar(tipoFijo, estadoDia).msg : 'Este día ya no admite más actividades.';
      cuerpoAgregar = `<p class="aviso-cupo"><i data-lucide="alert-circle" style="width:14px;height:14px"></i> ${esc(msg)}</p>`;
    }
  }

  return `
    <div class="superposicion" onclick="cerrarDia()">
      <div class="panel" onclick="event.stopPropagation()">
        <div class="panel-encabezado">
          <div>
            <p class="panel-fecha">${formatFechaLarga(estado.diaSeleccionado)}</p>
            <p class="panel-cupo">${estadoDia.ocupadas} de ${estadoDia.capacidad} entregas de tarea usadas${estadoDia.tieneEvento ? ' · día con evento' : ''}</p>
          </div>
          <button class="boton-icono" onclick="cerrarDia()"><i data-lucide="x"></i></button>
        </div>
        <div class="panel-cuerpo">
          ${items.length === 0 && !estado.formAbierto ? `<p class="panel-sin-actividades">Todavía no hay actividades este día.</p>` : ''}
          ${itemsHtml}
          ${cuerpoAgregar}
        </div>
      </div>
    </div>`;
}
function plantillaFormActividad(tipoFijo, estadoDia) {
  const tipoInicial = tipoFijo || 'tarea';
  const chequeoInicial = puedeAgregar(tipoInicial, estadoDia);
  const selectorTipo = tipoFijo === null ? `
    <div class="selector-tipo">
      <button type="button" id="btn-tipo-evento" class="opcion-tipo" onclick="alternarTipoActividad('evento')"><i data-lucide="flag" style="width:14px;height:14px"></i> Evento</button>
      <button type="button" id="btn-tipo-tarea" class="opcion-tipo opcion-tipo-activa" onclick="alternarTipoActividad('tarea')"><i data-lucide="book-open" style="width:14px;height:14px"></i> Tarea</button>
    </div>` : '';

  return `
    <form class="form-actividad" onsubmit="manejarEnvioActividad(event)">
      ${selectorTipo}
      <input type="hidden" id="campo-tipo" value="${tipoInicial}">
      <label class="etiqueta" id="etiqueta-titulo-actividad">${tipoInicial === 'evento' ? 'Nombre del evento' : 'Nombre de la tarea'}</label>
      <input class="campo" id="campo-titulo-actividad" placeholder="${tipoInicial === 'evento' ? 'Ej. Asamblea de padres de familia' : 'Ej. Entrega de ensayo final'}">
      <div id="bloque-campos-tarea" style="${tipoInicial === 'tarea' ? '' : 'display:none'}">
        <div class="fila-campos">
          <div><label class="etiqueta">Materia</label><input class="campo" id="campo-materia" placeholder="Ej. Matemática"></div>
          <div><label class="etiqueta">Grado / curso</label><input class="campo" id="campo-curso" placeholder="Ej. Cuarto Bachillerato"></div>
        </div>
      </div>
      <label class="etiqueta">Detalle (opcional)</label>
      <textarea class="campo campo-textarea" id="campo-descripcion-actividad" rows="3" placeholder="Instrucciones breves para el estudiante"></textarea>
      <div id="aviso-cupo-form">${chequeoInicial.ok ? '' : mensajeError(chequeoInicial.msg)}</div>
      <div id="error-form-actividad"></div>
      <div class="fila-botones">
        <button type="button" class="boton boton-fantasma" onclick="ocultarFormActividad()">Cancelar</button>
        <button type="submit" id="boton-guardar-actividad" class="boton boton-primario"${chequeoInicial.ok ? '' : ' disabled'}>Guardar actividad</button>
      </div>
    </form>`;
}

/* ---------- unidades ---------- */
function plantillaUnidades() {
  const esAdmin = estado.sesion.rol === 'admin';
  const ordenadas = unidadesOrdenadas();

  const formHtml = estado.formUnidadAbierto ? `
    <form class="tarjeta form-unidad" onsubmit="manejarEnvioUnidad(event)">
      <label class="etiqueta">Nombre de la unidad</label>
      <input class="campo" id="campo-nombre-unidad" value="${unidadEnEdicion ? esc(unidadEnEdicion.nombre) : ''}" placeholder="Ej. Unidad 3 — Segundo bimestre">
      <div class="fila-campos">
        <div><label class="etiqueta">Fecha de inicio</label><input type="date" class="campo" id="campo-fecha-inicio-unidad" value="${unidadEnEdicion ? unidadEnEdicion.fechaInicio : ''}"></div>
        <div><label class="etiqueta">Fecha de fin</label><input type="date" class="campo" id="campo-fecha-fin-unidad" value="${unidadEnEdicion ? unidadEnEdicion.fechaFin : ''}"></div>
      </div>
      <div id="error-form-unidad"></div>
      <div class="fila-botones">
        <button type="button" class="boton boton-fantasma" onclick="cerrarFormUnidad()">Cancelar</button>
        <button type="submit" id="boton-guardar-unidad" class="boton boton-primario">Guardar unidad</button>
      </div>
    </form>` : '';

  const listaHtml = ordenadas.length === 0 && !estado.formUnidadAbierto
    ? plantillaEstadoVacio('No hay unidades todavía', esAdmin ? 'Crea la primera unidad para empezar a planear.' : 'Administración aún no ha creado ninguna unidad.', '')
    : `<div class="lista-unidades">${ordenadas.map(u => {
        const total = estado.actividades.filter(a => a.unidadId === u.id).length;
        return `
          <div class="tarjeta-unidad">
            <button class="tarjeta-unidad-cuerpo" onclick="seleccionarUnidadActiva('${u.id}')">
              <p class="tarjeta-unidad-nombre">${esc(u.nombre)}</p>
              <p class="tarjeta-unidad-rango">${formatFechaCorta(u.fechaInicio)} — ${formatFechaCorta(u.fechaFin)}</p>
              <p class="tarjeta-unidad-conteo">${total} actividad${total === 1 ? '' : 'es'}</p>
            </button>
            ${esAdmin ? `
              <div class="tarjeta-unidad-acciones">
                <button class="boton-icono" onclick="abrirFormUnidad('${u.id}')" title="Editar"><i data-lucide="pencil" style="width:15px;height:15px"></i></button>
                <button class="boton-icono boton-icono-peligro" onclick="pedirConfirmarEliminarUnidad('${u.id}')" title="Eliminar"><i data-lucide="trash-2" style="width:15px;height:15px"></i></button>
              </div>` : ''}
          </div>`;
      }).join('')}</div>`;

  return `
    <div class="vista">
      <div class="vista-encabezado">
        <div>
          <h2 class="titulo-vista">Unidades</h2>
          <p class="subtitulo-vista">Cada unidad define su propio rango de fechas para el calendario.</p>
        </div>
        ${esAdmin ? `<button class="boton boton-primario" onclick="abrirFormUnidad(null)"><i data-lucide="plus" style="width:16px;height:16px"></i> Nueva unidad</button>` : ''}
      </div>
      ${formHtml}
      ${listaHtml}
    </div>`;
}

/* ---------- reporte ---------- */
function plantillaReporte() {
  if (!estado.unidades.length) {
    return plantillaEstadoVacio('No hay unidades para reportar', 'Crea una unidad y agrega actividades para poder generar el reporte.', '');
  }
  const idReporte = estado.unidadReporteId || estado.unidadActivaId || unidadesOrdenadas()[0].id;
  const unidad = estado.unidades.find(u => u.id === idReporte);
  const items = estado.actividades
    .filter(a => a.unidadId === idReporte)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.tipo === b.tipo ? 0 : a.tipo === 'evento' ? -1 : 1));

  const opciones = unidadesOrdenadas().map(u => `<option value="${u.id}"${u.id === idReporte ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('');
  const nombreColegio = estado.configuracion.nombreColegio || '';

  const filasTabla = items.map(a => {
    const detalle = [a.materia, a.curso].filter(Boolean).join(' · ') + (a.descripcion ? (([a.materia, a.curso].filter(Boolean).length ? ' — ' : '') + a.descripcion) : '');
    return `
      <tr>
        <td class="celda-fecha">${formatFechaLarga(a.fecha)}</td>
        <td><span class="etiqueta-tipo ${a.tipo === 'evento' ? 'etiqueta-evento' : 'etiqueta-tarea'}">${a.tipo === 'evento' ? 'Evento' : 'Tarea'}</span></td>
        <td>${esc(a.titulo)}</td>
        <td class="celda-detalle">${esc(detalle)}</td>
        <td>${ROLES[a.rol] ? ROLES[a.rol].label : esc(a.rol)}${a.responsable ? ' · ' + esc(a.responsable) : ''}</td>
      </tr>`;
  }).join('');

  return `
    <div class="vista">
      <div class="vista-encabezado no-imprimir">
        <div>
          <h2 class="titulo-vista">Reporte de la unidad</h2>
          <p class="subtitulo-vista">Genera el plan de actividades para entregar a los estudiantes.</p>
        </div>
        <button class="boton boton-primario" onclick="window.print()"><i data-lucide="printer" style="width:16px;height:16px"></i> Imprimir / descargar PDF</button>
      </div>

      <div class="controles-reporte no-imprimir">
        <div><label class="etiqueta">Unidad</label><select class="selector" onchange="cambiarUnidadReporte(this.value)">${opciones}</select></div>
        <div><label class="etiqueta">Nombre del establecimiento</label>
          <input class="campo" value="${esc(nombreColegio)}" oninput="actualizarNombreColegioEnPantalla(this.value)" onchange="guardarNombreColegio(this)"${estado.sesion.rol === 'admin' ? '' : ' disabled'}>
        </div>
      </div>

      ${unidad ? `
      <div id="reporte-imprimible" class="hoja-reporte">
        <div class="reporte-encabezado">
          <p class="reporte-colegio" id="reporte-colegio-texto">${esc(nombreColegio || 'Establecimiento educativo')}</p>
          <h1 class="reporte-titulo">Plan de actividades y tareas</h1>
          <p class="reporte-unidad">${esc(unidad.nombre)}</p>
          <p class="reporte-rango">${formatFechaLarga(unidad.fechaInicio)} — ${formatFechaLarga(unidad.fechaFin)}</p>
        </div>
        ${items.length === 0
          ? `<p class="reporte-vacio">Esta unidad todavía no tiene actividades registradas.</p>`
          : `<table class="tabla-reporte"><thead><tr><th>Fecha</th><th>Tipo</th><th>Actividad</th><th>Detalle</th><th>Responsable</th></tr></thead><tbody>${filasTabla}</tbody></table>`}
        <p class="reporte-pie">Generado el ${formatFechaLarga(hoyStr())} · ${items.length} actividad${items.length === 1 ? '' : 'es'} en total</p>
      </div>` : ''}
    </div>`;
}

/* ---------- piezas comunes ---------- */
function plantillaEstadoVacio(titulo, cuerpo, accionHtml) {
  return `
    <div class="vista">
      <div class="estado-vacio">
        <i data-lucide="calendar-days"></i>
        <h3>${esc(titulo)}</h3>
        <p>${esc(cuerpo)}</p>
        ${accionHtml || ''}
      </div>
    </div>`;
}
function plantillaConfirmar() {
  return `
    <div class="superposicion centrado" onclick="cancelarConfirmacion()">
      <div class="dialogo" onclick="event.stopPropagation()">
        <p class="dialogo-mensaje">${esc(estado.confirmar.mensaje)}</p>
        <div class="fila-botones">
          <button class="boton boton-fantasma" onclick="cancelarConfirmacion()">Cancelar</button>
          <button class="boton boton-peligro" onclick="ejecutarConfirmacion()">Eliminar</button>
        </div>
      </div>
    </div>`;
}

document.addEventListener('DOMContentLoaded', iniciar);
