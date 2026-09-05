const URL_API = 'https://script.google.com/macros/s/AKfycbzYqtU6jbQaGrn_KRFRwXWDI3IqO1l32LSqb2VXDZJ2DkmwZ4rg-UGvqy97RDxRl4g/exec';

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS_CORTOS = ['Lu','Ma','Mi','Ju','Vi','Sa','Do'];
const DIAS_LARGOS = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
const ROLES = {
  admin:    { label: 'Administración', icono: 'landmark' },
  comision: { label: 'Comisión',       icono: 'users' },
  profesor: { label: 'Profesor',       icono: 'graduation-cap' },
};
const TIPO_FIJO_POR_ROL = { comision: 'evento', profesor: 'tarea', admin: null };

const estado = {
  cargando: true,
  hayUsuarios: null,
  sesion: null,
  unidades: [],
  actividades: [],
  usuarios: [],
  configuracion: { nombreColegio: 'Instituto de Educación Media', grados: '' },
  vista: 'calendario',
  unidadActivaId: null,
  unidadReporteId: null,
  gradoFiltroCalendario: 'TODOS',
  gradoFiltroReporte: 'TODOS',
  mesActual: null,
  diaSeleccionado: null,
  formAbierto: false,
  formUnidadAbierto: false,
  formUsuarioAbierto: false,
  confirmar: null,
};
let unidadEnEdicion = null;
let rolNuevoUsuario = 'profesor';

try {
  const guardada = localStorage.getItem('planea-sesion');
  if (guardada) estado.sesion = JSON.parse(guardada);
} catch (e) {}

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
function fechaValida(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
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

function obtenerGradosDisponibles() {
  const acts = actividadesUnidadActual();
  const gradosSet = new Set();
  if (estado.configuracion.grados) {
    estado.configuracion.grados.split(',').forEach(g => {
      if (g.trim()) gradosSet.add(g.trim());
    });
  }
  acts.forEach(a => {
    if (a.curso && a.curso.trim() !== '') {
      gradosSet.add(a.curso.trim());
    }
  });
  return Array.from(gradosSet).sort();
}

function getEstadoDiaFiltrado(fechaStr, actividades, gradoFiltro) {
  const delDia = actividades.filter(a => a.fecha === fechaStr);
  const eventos = delDia.filter(a => a.tipo === 'evento');
  const tareas = delDia.filter(a => {
    if (a.tipo !== 'tarea') return false;
    if (gradoFiltro === 'TODOS') return true;
    return a.curso && a.curso.trim().toLowerCase() === gradoFiltro.toLowerCase();
  });

  const tieneEvento = eventos.length > 0;
  const capacidad = tieneEvento ? 2 : 5;
  const ocupadas = tareas.length;
  let esta = 'libre';
  if (ocupadas >= capacidad) esta = 'lleno';
  else if (ocupadas >= Math.ceil(capacidad / 2)) esta = 'medio';

  return { delDiaVisible: [...eventos, ...tareas], eventos, tareas, tieneEvento, capacidad, ocupadas, estado: esta };
}

function puedeAgregar(tipo, estadoDiaReal) {
  if (tipo === 'evento') {
    if (estadoDiaReal.tieneEvento) return { ok: false, msg: 'Este día ya tiene un evento de comisión asignado.' };
    if (estadoDiaReal.tareas.length > 2) return { ok: false, msg: 'Este día ya tiene más de 2 tareas generales asignadas.' };
    return { ok: true };
  }
  if (estadoDiaReal.ocupadas >= estadoDiaReal.capacidad) {
    return { ok: false, msg: `Este día alcanzó el máximo de ${estadoDiaReal.capacidad} actividades de entrega.` };
  }
  return { ok: true };
}

function unidadActiva() { return estado.unidades.find(u => u.id === estado.unidadActivaId) || null; }
function actividadesUnidadActual() { return estado.actividades.filter(a => a.unidadId === estado.unidadActivaId); }
function unidadesOrdenadas() { return [...estado.unidades].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio)); }

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

async function iniciar() {
  if (!URL_API || URL_API.includes('PON_AQUI')) {
    document.getElementById('app').innerHTML = plantillaConfigPendiente();
    return;
  }
  render();
  try {
    const usuariosPublicos = await api('usuarios');
    estado.usuarios = Array.isArray(usuariosPublicos) ? usuariosPublicos : [];
    estado.hayUsuarios = estado.usuarios.length > 0;

    const [unidades, actividades, configuracion] = await Promise.all([
      api('unidades'), api('actividades'), api('configuracion'),
    ]);
    estado.unidades = (Array.isArray(unidades) ? unidades : [])
      .filter(u => u && u.id && u.nombre && fechaValida(u.fechaInicio) && fechaValida(u.fechaFin));
    estado.actividades = (Array.isArray(actividades) ? actividades : [])
      .filter(a => a && a.id && a.unidadId && fechaValida(a.fecha) && a.tipo && a.titulo);
    
    estado.configuracion = Object.assign({ nombreColegio: 'Instituto de Educación Media', grados: '' }, configuracion || {});
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
    console.error(e);
  } finally {
    estado.cargando = false;
    render();
  }
}

async function manejarEnvioPrimerAdmin(ev) {
  ev.preventDefault();
  const nombre = document.getElementById('campo-nombre-primer-admin').value.trim();
  const usuario = document.getElementById('campo-usuario-primer-admin').value.trim();
  const contrasena = document.getElementById('campo-contrasena-primer-admin').value;
  const errorEl = document.getElementById('error-primer-admin');
  if (!nombre || !usuario) { errorEl.innerHTML = mensajeError('Completa los campos.'); return; }
  if (contrasena.length < 4) { errorEl.innerHTML = mensajeError('Mínimo 4 caracteres.'); return; }

  try {
    const nuevo = { id: generarId(), nombre, usuario, contrasena, rol: 'admin' };
    const resultado = await api('usuarios', { metodo: 'POST', accion: 'crear', datos: nuevo });
    if (!resultado.ok) { errorEl.innerHTML = mensajeError(resultado.error); return; }
    estado.usuarios = resultado.lista;
    estado.hayUsuarios = true;
    estado.sesion = { usuario, nombre, rol: 'admin' };
    try { localStorage.setItem('planea-sesion', JSON.stringify(estado.sesion)); } catch (e) {}
    render();
  } catch (e) { errorEl.innerHTML = mensajeError('Error de conexión.'); }
}

async function manejarEnvioLogin(ev) {
  ev.preventDefault();
  const usuario = document.getElementById('campo-usuario-login').value.trim();
  const contrasena = document.getElementById('campo-contrasena-login').value;
  const errorEl = document.getElementById('error-login');
  if (!usuario || !contrasena) { errorEl.innerHTML = mensajeError('Escribe usuario y contraseña.'); return; }

  try {
    const resultado = await api('sesion', { metodo: 'POST', accion: 'iniciar', datos: { usuario, contrasena } });
    if (!resultado.ok) { errorEl.innerHTML = mensajeError(resultado.error); return; }
    estado.sesion = { usuario: resultado.usuario, nombre: resultado.nombre, rol: resultado.rol };
    try { localStorage.setItem('planea-sesion', JSON.stringify(estado.sesion)); } catch (e) {}
    render();
  } catch (e) { errorEl.innerHTML = mensajeError('Error de conexión.'); }
}

function cerrarSesion() {
  estado.sesion = null;
  try { localStorage.removeItem('planea-sesion'); } catch (e) {}
  render();
}
function cambiarVista(v) { estado.vista = v; render(); }

function seleccionarUnidadActiva(id) {
  estado.unidadActivaId = id;
  const u = estado.unidades.find(x => x.id === id);
  if (u) { const di = parseFecha(u.fechaInicio); estado.mesActual = { year: di.getFullYear(), month: di.getMonth() }; }
  estado.vista = 'calendario';
  render();
}

function cambiarFiltroGradoCalendario(grado) { estado.gradoFiltroCalendario = grado; render(); }
function abrirFormUnidad(id) { unidadEnEdicion = id ? estado.unidades.find(u => u.id === id) : null; estado.formUnidadAbierto = true; render(); }
function cerrarFormUnidad() { estado.formUnidadAbierto = false; unidadEnEdicion = null; render(); }

async function manejarEnvioUnidad(ev) {
  ev.preventDefault();
  const nombre = document.getElementById('campo-nombre-unidad').value.trim();
  let fechaInicio = document.getElementById('campo-fecha-inicio-unidad').value;
  let fechaFin = document.getElementById('campo-fecha-fin-unidad').value;
  const errorEl = document.getElementById('error-form-unidad');

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaInicio)) { const [d, m, y] = fechaInicio.split('/'); fechaInicio = `${y}-${m}-${d}`; }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(fechaFin)) { const [d, m, y] = fechaFin.split('/'); fechaFin = `${y}-${m}-${d}`; }

  if (!nombre) { errorEl.innerHTML = mensajeError('Escribe un nombre.'); return; }
  if (!fechaInicio || !fechaFin) { errorEl.innerHTML = mensajeError('Indica fechas.'); return; }
  if (fechaFin < fechaInicio) { errorEl.innerHTML = mensajeError('Fecha fin anterior a inicio.'); return; }

  try {
    if (unidadEnEdicion) {
      const resultado = await api('unidades', { metodo: 'POST', accion: 'editar', datos: { id: unidadEnEdicion.id, nombre, fechaInicio, fechaFin } });
      estado.unidades = resultado.lista || estado.unidades;
    } else {
      const nueva = { id: generarId(), nombre, fechaInicio, fechaFin };
      const resultado = await api('unidades', { metodo: 'POST', accion: 'crear', datos: nueva });
      estado.unidades = resultado.lista || estado.unidades;
      if (!estado.unidadActivaId) { estado.unidadActivaId = nueva.id; const di = parseFecha(nueva.fechaInicio); estado.mesActual = { year: di.getFullYear(), month: di.getMonth() }; }
    }
    estado.formUnidadAbierto = false; unidadEnEdicion = null; render();
  } catch (e) { errorEl.innerHTML = mensajeError('No se pudo guardar.'); }
}

function pedirConfirmarEliminarUnidad(id) {
  const u = estado.unidades.find(x => x.id === id);
  if (!u) return;
  estado.confirmar = {
    mensaje: `¿Eliminar la unidad "${u.nombre}" y sus actividades?`,
    accion: async () => {
      const resultado = await api('unidades', { metodo: 'POST', accion: 'eliminar', datos: { id } });
      estado.unidades = resultado.lista || [];
      estado.actividades = await api('actividades');
      if (estado.unidadActivaId === id) estado.unidadActivaId = null;
    },
  };
  render();
}

function abrirDia(fecha) { estado.diaSeleccionado = fecha; estado.formAbierto = false; render(); }
function cerrarDia() { estado.diaSeleccionado = null; estado.formAbierto = false; render(); }
function mostrarFormActividad() { estado.formAbierto = true; render(); }
function ocultarFormActividad() { estado.formAbierto = false; render(); }

function alternarTipoActividad(tipo) {
  document.getElementById('campo-tipo').value = tipo;
  document.getElementById('btn-tipo-evento').classList.toggle('opcion-tipo-activa', tipo === 'evento');
  document.getElementById('btn-tipo-tarea').classList.toggle('opcion-tipo-activa', tipo === 'tarea');
  document.getElementById('bloque-campos-tarea').style.display = tipo === 'tarea' ? '' : 'none';
}

async function manejarEnvioActividad(ev) {
  ev.preventDefault();
  const tipo = document.getElementById('campo-tipo').value;
  const titulo = document.getElementById('campo-titulo-actividad').value.trim();
  const materia = tipo === 'tarea' ? document.getElementById('campo-materia').value.trim() : '';
  const curso = tipo === 'tarea' ? document.getElementById('campo-curso').value.trim() : '';
  const descripcion = document.getElementById('campo-descripcion-actividad').value.trim();
  const errorEl = document.getElementById('error-form-actividad');

  if (!titulo) { errorEl.innerHTML = mensajeError('Escribe un título.'); return; }
  
  const actividadesActuales = actividadesUnidadActual();
  const estadoDiaReal = {
    delDia: actividadesActuales.filter(a => a.fecha === estado.diaSeleccionado),
    eventos: actividadesActuales.filter(a => a.fecha === estado.diaSeleccionado && a.tipo === 'evento'),
    tareas: actividadesActuales.filter(a => a.fecha === estado.diaSeleccionado && a.tipo === 'tarea'),
  };
  estadoDiaReal.tieneEvento = estadoDiaReal.eventos.length > 0;
  estadoDiaReal.ocupadas = estadoDiaReal.tareas.length;
  estadoDiaReal.capacidad = estadoDiaReal.tieneEvento ? 2 : 5;

  const chequeo = puedeAgregar(tipo, estadoDiaReal);
  if (!chequeo.ok) { errorEl.innerHTML = mensajeError(chequeo.msg); return; }

  try {
    const nueva = {
      id: generarId(), unidadId: estado.unidadActivaId, fecha: estado.diaSeleccionado,
      tipo, titulo, descripcion, materia, curso,
      rol: estado.sesion.rol, responsable: estado.sesion.nombre, creadoEn: Date.now(),
    };
    const resultado = await api('actividades', { metodo: 'POST', accion: 'crear', datos: nueva });
    estado.actividades = resultado.lista || estado.actividades;
    estado.formAbierto = false; render();
  } catch (e) { errorEl.innerHTML = mensajeError('No se pudo guardar.'); }
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

function elegirRolNuevoUsuario(rol) {
  rolNuevoUsuario = rol;
  document.querySelectorAll('#form-usuario .opcion-rol').forEach(btn => {
    btn.classList.toggle('opcion-rol-activa', btn.dataset.rol === rol);
  });
}
function abrirFormUsuario() { rolNuevoUsuario = 'profesor'; estado.formUsuarioAbierto = true; render(); }
function cerrarFormUsuario() { estado.formUsuarioAbierto = false; render(); }

async function manejarEnvioUsuario(ev) {
  ev.preventDefault();
  const nombre = document.getElementById('campo-nombre-usuario').value.trim();
  const usuario = document.getElementById('campo-usuario-usuario').value.trim();
  const contrasena = document.getElementById('campo-contrasena-usuario').value;
  const errorEl = document.getElementById('error-form-usuario');

  if (!nombre || !usuario) { errorEl.innerHTML = mensajeError('Completa los campos.'); return; }
  if (contrasena.length < 4) { errorEl.innerHTML = mensajeError('Mínimo 4 caracteres.'); return; }

  try {
    const nuevo = { id: generarId(), nombre, usuario, contrasena, rol: rolNuevoUsuario };
    const resultado = await api('usuarios', { metodo: 'POST', accion: 'crear', datos: nuevo });
    if (!resultado.ok) { errorEl.innerHTML = mensajeError(resultado.error); return; }
    estado.usuarios = resultado.lista; estado.formUsuarioAbierto = false; render();
  } catch (e) { errorEl.innerHTML = mensajeError('Error de conexión.'); }
}

function mostrarFormRestablecer(id) {
  const el = document.getElementById(`restablecer-${id}`);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}
async function restablecerContrasena(id) {
  const input = document.getElementById(`campo-nueva-clave-${id}`);
  const nueva = input.value;
  if (nueva.length < 4) return;
  await api('usuarios', { metodo: 'POST', accion: 'restablecer', datos: { id, contrasena: nueva } });
  input.value = '';
}

function ejecutarConfirmacion() {
  const c = estado.confirmar;
  if (!c) return;
  estado.confirmar = null;
  c.accion().then(() => render());
}
function cancelarConfirmacion() { estado.confirmar = null; render(); }

function cambiarUnidadReporte(id) { estado.unidadReporteId = id; render(); }
function cambiarGradoReporte(grado) { estado.gradoFiltroReporte = grado; render(); }

async function guardarNombreColegio(input) {
  const valor = input.value.trim();
  estado.configuracion.nombreColegio = valor;
  await api('configuracion', { metodo: 'POST', datos: { nombreColegio: valor } });
}

async function guardarGradosConfig(input) {
  const valor = input.value.trim();
  estado.configuracion.grados = valor;
  await api('configuracion', { metodo: 'POST', datos: { grados: valor } });
}

function render() {
  const raiz = document.getElementById('app');
  if (estado.cargando) { raiz.innerHTML = `<div class="pantalla-carga"><i data-lucide="loader-2" class="girando"></i><p>Cargando planeador...</p></div>`; return; }
  if (!estado.sesion) {
    raiz.innerHTML = estado.hayUsuarios === false ? plantillaPrimerAdmin() : plantillaLogin();
    crearIconos();
    return;
  }
  raiz.innerHTML = plantillaApp();
  crearIconos();
}
function crearIconos() { if (window.lucide) lucide.createIcons(); }

function plantillaPrimerAdmin() {
  return `
    <div class="acceso">
      <div class="acceso-tarjeta">
        <div class="acceso-marca"><i data-lucide="calendar-days"></i><span>Planea</span></div>
        <h1>Cuenta de Administración</h1>
        <form class="acceso-form" onsubmit="manejarEnvioPrimerAdmin(event)">
          <label class="etiqueta">Tu nombre</label><input class="campo" id="campo-nombre-primer-admin" placeholder="Nombre completo">
          <label class="etiqueta">Usuario</label><input class="campo" id="campo-usuario-primer-admin" placeholder="admin">
          <label class="etiqueta">Contraseña</label><input class="campo" type="password" id="campo-contrasena-primer-admin" placeholder="Mínimo 4 caracteres">
          <div id="error-primer-admin"></div>
          <button type="submit" class="boton boton-primario boton-ancho">Crear cuenta</button>
        </form>
      </div>
    </div>`;
}

function plantillaLogin() {
  return `
    <div class="acceso">
      <div class="acceso-tarjeta">
        <div class="acceso-marca"><i data-lucide="calendar-days"></i><span>Planea</span></div>
        <h1>Iniciar sesión</h1>
        <form class="acceso-form" onsubmit="manejarEnvioLogin(event)">
          <label class="etiqueta">Usuario</label><input class="campo" id="campo-usuario-login">
          <label class="etiqueta">Contraseña</label><input class="campo" type="password" id="campo-contrasena-login">
          <div id="error-login"></div>
          <button type="submit" class="boton boton-primario boton-ancho">Entrar</button>
        </form>
      </div>
    </div>`;
}

function plantillaApp() {
  return `
    <div class="cascaron">
      ${plantillaBarra()}
      <main class="contenido">
        ${estado.vista === 'calendario' ? plantillaCalendario() : ''}
        ${estado.vista === 'unidades' ? plantillaUnidades() : ''}
        ${estado.vista === 'usuarios' ? plantillaUsuarios() : ''}
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
  if (estado.sesion.rol === 'admin') items.push({ clave: 'usuarios', label: 'Usuarios', icono: 'key-round' });
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
        <button class="barra-salir" onclick="cerrarSesion()" title="Salir"><i data-lucide="log-out"></i></button>
      </div>
    </aside>`;
}

function plantillaCalendario() {
  if (!estado.unidades.length) {
    return plantillaEstadoVacio('No hay unidades', 'Crea una unidad primero.', estado.sesion.rol === 'admin' ? `<button class="boton boton-primario" onclick="cambiarVista('unidades')">Crear unidad</button>` : '');
  }
  const unidad = unidadActiva();
  if (!unidad) return plantillaEstadoVacio('Elige una unidad', 'Selecciona una unidad.');

  const gradosDisponibles = obtenerGradosDisponibles();
  const opcionesGrados = `<option value="TODOS"${estado.gradoFiltroCalendario === 'TODOS' ? ' selected' : ''}>Todos los grados (General)</option>` +
    gradosDisponibles.map(g => `<option value="${esc(g)}"${estado.gradoFiltroCalendario === g ? ' selected' : ''}>${esc(g)}</option>`).join('');

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
        
        const info = getEstadoDiaFiltrado(fechaStr, actividadesUnidad, estado.gradoFiltroCalendario);
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
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;">
          <div>
            <label class="etiqueta-inline">Unidad</label>
            <select class="selector" onchange="seleccionarUnidadActiva(this.value)">${opcionesUnidad}</select>
          </div>
          <div>
            <label class="etiqueta-inline">Filtrar por Grado / Curso</label>
            <select class="selector" onchange="cambiarFiltroGradoCalendario(this.value)">${opcionesGrados}</select>
          </div>
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
    </div>`;
}

function cambiarMes(delta) {
  const total = estado.mesActual.year * 12 + estado.mesActual.month + delta;
  estado.mesActual = { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
  render();
}

function plantillaPanelDia() {
  const actividadesActuales = actividadesUnidadActual();
  const info = getEstadoDiaFiltrado(estado.diaSeleccionado, actividadesActuales, estado.gradoFiltroCalendario);
  const tipoFijo = TIPO_FIJO_POR_ROL[estado.sesion.rol];
  const items = info.delDiaVisible;

  const itemsHtml = items.map(a => `
    <div class="item-actividad ${a.tipo === 'evento' ? 'item-evento' : 'item-tarea'}">
      <div class="item-icono"><i data-lucide="${a.tipo === 'evento' ? 'flag' : 'book-open'}" style="width:15px;height:15px"></i></div>
      <div class="item-cuerpo">
        <p class="item-titulo">${esc(a.titulo)} ${a.curso ? `<span style="font-size:11px;background:#e2e8f0;padding:2px 6px;border-radius:4px;">${esc(a.curso)}</span>` : ''}</p>
        ${a.tipo === 'tarea' && a.materia ? `<p class="item-meta">Materia: ${esc(a.materia)}</p>` : ''}
        ${a.descripcion ? `<p class="item-descripcion">${esc(a.descripcion)}</p>` : ''}
        <p class="item-responsable">${ROLES[a.rol] ? ROLES[a.rol].label : esc(a.rol)} · ${esc(a.responsable)}</p>
      </div>
      ${puedeEliminarActividad(a) ? `<button class="item-eliminar" onclick="pedirConfirmarEliminarActividad('${a.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>` : ''}
    </div>`).join('');

  let cuerpoAgregar = estado.formAbierto ? plantillaFormActividad(tipoFijo) : `<button class="boton boton-secundario boton-ancho" onclick="mostrarFormActividad()"><i data-lucide="plus"></i> Agregar actividad</button>`;

  return `
    <div class="superposicion" onclick="cerrarDia()">
      <div class="panel" onclick="event.stopPropagation()">
        <div class="panel-encabezado">
          <div>
            <p class="panel-fecha">${formatFechaLarga(estado.diaSeleccionado)}</p>
            <p class="panel-cupo">Grado actual: <b>${esc(estado.gradoFiltroCalendario)}</b></p>
          </div>
          <button class="boton-icono" onclick="cerrarDia()"><i data-lucide="x"></i></button>
        </div>
        <div class="panel-cuerpo">
          ${items.length === 0 && !estado.formAbierto ? `<p class="panel-sin-actividades">No hay actividades para este grado en este día.</p>` : ''}
          ${itemsHtml}
          ${cuerpoAgregar}
        </div>
      </div>
    </div>`;
}

function plantillaFormActividad(tipoFijo) {
  const tipoInicial = tipoFijo || 'tarea';
  const selectorTipo = tipoFijo === null ? `
    <div class="selector-tipo">
      <button type="button" id="btn-tipo-evento" class="opcion-tipo" onclick="alternarTipoActividad('evento')"><i data-lucide="flag"></i> Evento</button>
      <button type="button" id="btn-tipo-tarea" class="opcion-tipo opcion-tipo-activa" onclick="alternarTipoActividad('tarea')"><i data-lucide="book-open"></i> Tarea</button>
    </div>` : '';

  return `
    <form class="form-actividad" onsubmit="manejarEnvioActividad(event)">
      ${selectorTipo}
      <input type="hidden" id="campo-tipo" value="${tipoInicial}">
      <label class="etiqueta">Título</label>
      <input class="campo" id="campo-titulo-actividad" placeholder="Nombre de la actividad">
      <div id="bloque-campos-tarea" style="${tipoInicial === 'tarea' ? '' : 'display:none'}">
        <div class="fila-campos">
          <div><label class="etiqueta">Materia</label><input class="campo" id="campo-materia" placeholder="Ej. Matemática"></div>
          <div><label class="etiqueta">Grado / Curso</label><input class="campo" id="campo-curso" placeholder="Ej. 4to Bachillerato"></div>
        </div>
      </div>
      <label class="etiqueta">Detalle o instrucciones</label>
      <textarea class="campo campo-textarea" id="campo-descripcion-actividad" rows="3"></textarea>
      <div id="error-form-actividad"></div>
      <div class="fila-botones">
        <button type="button" class="boton boton-fantasma" onclick="ocultarFormActividad()">Cancelar</button>
        <button type="submit" class="boton boton-primario">Guardar</button>
      </div>
    </form>`;
}

function plantillaUnidades() {
  const esAdmin = estado.sesion.rol === 'admin';
  const ordenadas = unidadesOrdenadas();
  const formHtml = estado.formUnidadAbierto ? `
    <form class="tarjeta form-unidad" onsubmit="manejarEnvioUnidad(event)">
      <label class="etiqueta">Nombre de la unidad</label>
      <input class="campo" id="campo-nombre-unidad" value="${unidadEnEdicion ? esc(unidadEnEdicion.nombre) : ''}">
      <div class="fila-campos">
        <div><label class="etiqueta">Inicio</label><input type="date" class="campo" id="campo-fecha-inicio-unidad" value="${unidadEnEdicion ? unidadEnEdicion.fechaInicio : ''}"></div>
        <div><label class="etiqueta">Fin</label><input type="date" class="campo" id="campo-fecha-fin-unidad" value="${unidadEnEdicion ? unidadEnEdicion.fechaFin : ''}"></div>
      </div>
      <div id="error-form-unidad"></div>
      <div class="fila-botones">
        <button type="button" class="boton boton-fantasma" onclick="cerrarFormUnidad()">Cancelar</button>
        <button type="submit" class="boton boton-primario">Guardar</button>
      </div>
    </form>` : '';

  return `
    <div class="vista">
      <div class="vista-encabezado">
        <div><h2 class="titulo-vista">Unidades</h2></div>
        ${esAdmin ? `<button class="boton boton-primario" onclick="abrirFormUnidad(null)"><i data-lucide="plus"></i> Nueva unidad</button>` : ''}
      </div>
      ${formHtml}
      <div class="lista-unidades">${ordenadas.map(u => `
        <div class="tarjeta-unidad">
          <button class="tarjeta-unidad-cuerpo" onclick="seleccionarUnidadActiva('${u.id}')">
            <p class="tarjeta-unidad-nombre">${esc(u.nombre)}</p>
            <p class="tarjeta-unidad-rango">${formatFechaCorta(u.fechaInicio)} — ${formatFechaCorta(u.fechaFin)}</p>
          </button>
          ${esAdmin ? `<div class="tarjeta-unidad-acciones"><button class="boton-icono" onclick="abrirFormUnidad('${u.id}')"><i data-lucide="pencil"></i></button><button class="boton-icono boton-icono-peligro" onclick="pedirConfirmarEliminarUnidad('${u.id}')"><i data-lucide="trash-2"></i></button></div>` : ''}
        </div>`).join('')}</div>
    </div>`;
}

function plantillaUsuarios() {
  if (estado.sesion.rol !== 'admin') return '';
  const opcionesRol = Object.entries(ROLES).map(([clave, r]) => `
    <button type="button" class="opcion-rol${clave === rolNuevoUsuario ? ' opcion-rol-activa' : ''}" onclick="elegirRolNuevoUsuario('${clave}')">
      <i data-lucide="${r.icono}"></i><span>${r.label}</span>
    </button>`).join('');

  return `
    <div class="vista">
      <div class="vista-encabezado">
        <div><h2 class="titulo-vista">Usuarios</h2></div>
        <button class="boton boton-primario" onclick="abrirFormUsuario()"><i data-lucide="plus"></i> Nuevo usuario</button>
      </div>
      ${estado.formUsuarioAbierto ? `
        <form class="tarjeta form-unidad" id="form-usuario" onsubmit="manejarEnvioUsuario(event)">
          <label class="etiqueta">Nombre</label><input class="campo" id="campo-nombre-usuario">
          <div class="fila-campos">
            <div><label class="etiqueta">Usuario</label><input class="campo" id="campo-usuario-usuario"></div>
            <div><label class="etiqueta">Contraseña</label><input class="campo" type="password" id="campo-contrasena-usuario"></div>
          </div>
          <label class="etiqueta">Rol</label>
          <div class="selector-roles">${opcionesRol}</div>
          <div id="error-form-usuario"></div>
          <div class="fila-botones"><button type="button" class="boton boton-fantasma" onclick="cerrarFormUsuario()">Cancelar</button><button type="submit" class="boton boton-primario">Crear</button></div>
        </form>` : ''}
      <div class="lista-unidades">${estado.usuarios.map(u => `
        <div class="tarjeta-unidad" style="flex-direction:column;">
          <div style="display:flex;width:100%;">
            <div class="tarjeta-unidad-cuerpo"><p class="tarjeta-unidad-nombre">${esc(u.nombre)}</p><p class="tarjeta-unidad-rango">usuario: ${esc(u.usuario)} · ${ROLES[u.rol]?.label}</p></div>
            <div class="tarjeta-unidad-acciones"><button class="boton-icono" onclick="mostrarFormRestablecer('${u.id}')"><i data-lucide="key-round"></i></button><button class="boton-icono boton-icono-peligro" onclick="pedirConfirmarEliminarUnidad('${u.id}')"><i data-lucide="trash-2"></i></button></div>
          </div>
          <div id="restablecer-${u.id}" style="display:none;padding:10px;">
            <div class="fila-campos"><input class="campo" type="password" id="campo-nueva-clave-${u.id}" placeholder="Nueva clave"><button class="boton boton-secundario" onclick="restablecerContrasena('${u.id}')">Cambiar</button></div>
          </div>
        </div>`).join('')}</div>
    </div>`;
}

function plantillaReporte() {
  if (!estado.unidades.length) return plantillaEstadoVacio('Sin unidades', 'Crea una unidad.');
  const idReporte = estado.unidadReporteId || estado.unidadActivaId || unidadesOrdenadas()[0].id;
  const unidad = estado.unidades.find(u => u.id === idReporte);
  
  const gradosDisponibles = obtenerGradosDisponibles();
  const opcionesGrados = `<option value="TODOS"${estado.gradoFiltroReporte === 'TODOS' ? ' selected' : ''}>Todos los grados (General)</option>` +
    gradosDisponibles.map(g => `<option value="${esc(g)}"${estado.gradoFiltroReporte === g ? ' selected' : ''}>${esc(g)}</option>`).join('');

  const items = estado.actividades.filter(a => {
    if (a.unidadId !== idReporte) return false;
    if (a.tipo === 'evento') return true; 
    if (estado.gradoFiltroReporte === 'TODOS') return true;
    return a.curso && a.curso.trim().toLowerCase() === estado.gradoFiltroReporte.toLowerCase();
  }).sort((a, b) => a.fecha.localeCompare(b.fecha));

  const opcionesUnidad = unidadesOrdenadas().map(u => `<option value="${u.id}"${u.id === idReporte ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('');
  const nombreColegio = estado.configuracion.nombreColegio || '';

  const filasTabla = items.map(a => `
    <tr>
      <td class="celda-fecha">${formatFechaLarga(a.fecha)}</td>
      <td><span class="etiqueta-tipo ${a.tipo === 'evento' ? 'etiqueta-evento' : 'etiqueta-tarea'}">${a.tipo === 'evento' ? 'Evento' : 'Tarea'}</span></td>
      <td>${esc(a.titulo)} ${a.curso ? `<br><small>(${esc(a.curso)})</small>` : ''}</td>
      <td class="celda-detalle">${esc(a.materia || '')} ${a.descripcion ? '— ' + esc(a.descripcion) : ''}</td>
      <td>${esc(a.responsable)}</td>
    </tr>`).join('');

  return `
    <div class="vista">
      <div class="vista-encabezado no-imprimir">
        <div><h2 class="titulo-vista">Reporte por Grado</h2></div>
        <button class="boton boton-primario" onclick="window.print()"><i data-lucide="printer"></i> Imprimir / PDF</button>
      </div>

      <div class="controles-reporte no-imprimir" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
        <div><label class="etiqueta">Unidad</label><select class="selector" onchange="cambiarUnidadReporte(this.value)">${opcionesUnidad}</select></div>
        <div><label class="etiqueta">Grado</label><select class="selector" onchange="cambiarGradoReporte(this.value)">${opcionesGrados}</select></div>
        <div><label class="etiqueta">Establecimiento</label><input class="campo" value="${esc(nombreColegio)}" onchange="guardarNombreColegio(this)"></div>
        ${estado.sesion.rol === 'admin' ? `
        <div>
          <label class="etiqueta">Grados oficiales (separados por coma)</label>
          <input class="campo" value="${esc(estado.configuracion.grados || '')}" placeholder="Ej. 1ro Básico, 4to Bach" onchange="guardarGradosConfig(this)">
        </div>` : ''}
      </div>

      ${unidad ? `
      <div class="hoja-reporte">
        <div class="reporte-encabezado">
          <p class="reporte-colegio">${esc(nombreColegio)}</p>
          <h1 class="reporte-titulo">Plan de Actividades</h1>
          <p class="reporte-unidad">${esc(unidad.nombre)} — Grado: <b>${esc(estado.gradoFiltroReporte)}</b></p>
          <p class="reporte-rango">${formatFechaLarga(unidad.fechaInicio)} — ${formatFechaLarga(unidad.fechaFin)}</p>
        </div>
        ${items.length === 0 ? `<p class="reporte-vacio">No hay actividades registradas para este grado.</p>` : `
          <table class="tabla-reporte">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Actividad</th><th>Detalle</th><th>Responsable</th></tr></thead>
            <tbody>${filasTabla}</tbody>
          </table>`}
      </div>` : ''}
    </div>`;
}

function plantillaEstadoVacio(titulo, cuerpo, accionHtml) {
  return `<div class="vista"><div class="estado-vacio"><i data-lucide="calendar-days"></i><h3>${esc(titulo)}</h3><p>${esc(cuerpo)}</p>${accionHtml || ''}</div></div>`;
}
function plantillaConfirmar() {
  return `
    <div class="superposicion centrado" onclick="cancelarConfirmacion()">
      <div class="dialogo" onclick="event.stopPropagation()">
        <p class="dialogo-mensaje">${esc(estado.confirmar.mensaje)}</p>
        <div class="fila-botones"><button class="boton boton-fantasma" onclick="cancelarConfirmacion()">Cancelar</button><button class="boton boton-peligro" onclick="ejecutarConfirmacion()">Eliminar</button></div>
      </div>
    </div>`;
}

document.addEventListener('DOMContentLoaded', iniciar);
