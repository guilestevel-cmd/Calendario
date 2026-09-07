const URL_API = 'https://script.google.com/macros/s/AKfycbyXSOthf8ckGUBBXy4mFNjYKL7xaVZkzx8cIS6Zhkkptlvu9-DLb4YLR1DoE7XUv-m8lQ/exec';

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS_CORTOS = ['Lu','Ma','Mi','Ju','Vi','Sa','Do'];
const DIAS_LARGOS = ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
const ROLES = {
  admin:        { label: 'Administración',         icono: 'landmark' },
  comision:     { label: 'Comisión',               icono: 'users' },
  direccion:    { label: 'Dirección / Secretaría', icono: 'shield-check' },
  profesor:     { label: 'Profesor',               icono: 'graduation-cap' },
};
const TIPO_FIJO_POR_ROL = { comision: 'evento', direccion: 'evento', profesor: 'tarea', admin: null };

const estado = {
  cargando: true,
  hayUsuarios: null,
  sesion: null,
  unidades: [],
  actividades: [],
  usuarios: [],
  grados: [],
  configuracion: { nombreColegio: 'Instituto de Educación Media', calendarioCerrado: 'false' },
  vista: 'calendario',
  unidadActivaId: null,
  unidadReporteId: '',
  gradoActivoCalendario: '',
  gradoFiltroReporte: '',
  mesActual: null,
  diaSeleccionado: null,
  formAbierto: false,
  formUnidadAbierto: false,
  formUsuarioAbierto: false,
  formGradoAbierto: false,
  confirmar: null,
};
let unidadEnEdicion = null;
let actividadEnEdicion = null;
let usuarioEnEdicion = null;
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

function esRolGlobal(rol) {
  return rol === 'comision' || rol === 'direccion' || rol === 'admin';
}

function getEstadoDiaGrado(fechaStr, actividades, gradoSeleccionado) {
  const delDia = actividades.filter(a => a.fecha === fechaStr);
  
  const visibles = delDia.filter(a => {
    if (esRolGlobal(a.rol)) {
      if (!a.curso || a.curso === 'TODOS' || a.curso === '') return true;
      return a.curso.trim().toLowerCase() === gradoSeleccionado.trim().toLowerCase();
    }
    return a.curso && a.curso.trim().toLowerCase() === gradoSeleccionado.trim().toLowerCase();
  });

  const eventos = visibles.filter(a => a.tipo === 'evento');
  const tareas = visibles.filter(a => a.tipo === 'tarea');

  const tieneEvento = eventos.length > 0;
  const capacidad = tieneEvento ? 2 : 5;
  const ocupadas = tareas.length;
  let esta = 'libre';
  if (ocupadas >= capacidad) esta = 'lleno';
  else if (ocupadas >= Math.ceil(capacidad / 2)) esta = 'medio';

  return { delDiaVisible: visibles, eventos, tareas, tieneEvento, capacidad, ocupadas, estado: esta };
}

function puedeAgregar(tipo, estadoDiaReal) {
  if (tipo === 'evento') {
    if (estadoDiaReal.tieneEvento) return { ok: false, msg: 'Este día ya cuenta con un evento institucional relevante.' };
    return { ok: true };
  }
  if (estadoDiaReal.ocupadas >= estadoDiaReal.capacidad) {
    return { ok: false, msg: `Se alcanzó el límite de ${estadoDiaReal.capacidad} actividades para este grado en esta fecha.` };
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

    const [unidades, actividades, grados, configuracion] = await Promise.all([
      api('unidades'), api('actividades'), api('grados'), api('configuracion'),
    ]);
    estado.unidades = (Array.isArray(unidades) ? unidades : [])
      .filter(u => u && u.id && u.nombre && fechaValida(u.fechaInicio) && fechaValida(u.fechaFin));
    estado.actividades = (Array.isArray(actividades) ? actividades : [])
      .filter(a => a && a.id && a.unidadId && fechaValida(a.fecha) && a.tipo && a.titulo);
    estado.grados = Array.isArray(grados) ? grados : [];
    
    estado.configuracion = Object.assign({ nombreColegio: 'Instituto de Educación Media', calendarioCerrado: 'false' }, configuracion || {});
    
    if (estado.grados.length > 0 && !estado.gradoActivoCalendario) {
      estado.gradoActivoCalendario = estado.grados[0].nombre;
    }

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

function cambiarGradoActivoCalendario(grado) {
  estado.gradoActivoCalendario = grado;
  render();
}

function abrirFormUnidad(id) { unidadEnEdicion = id ? estado.unidades.find(u => u.id === id) : null; estado.formUnidadAbierto = true; render(); }
function cerrarFormUnidad() { estado.formUnidadAbierto = false; unidadEnEdicion = null; render(); }

async function manejarEnvioUnidad(ev) {
  ev.preventDefault();
  const nombre = document.getElementById('campo-nombre-unidad').value.trim();
  let fechaInicio = document.getElementById('campo-fecha-inicio-unidad').value;
  let fechaFin = document.getElementById('campo-fecha-fin-unidad').value;
  const errorEl = document.getElementById('error-form-unidad');

  if (!nombre || !fechaInicio || !fechaFin) { errorEl.innerHTML = mensajeError('Completa todos los campos.'); return; }

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

/* ============================== GESTIÓN DE GRADOS =============================== */
function abrirFormGrado() { estado.formGradoAbierto = true; render(); }
function cerrarFormGrado() { estado.formGradoAbierto = false; render(); }

async function manejarEnvioGrado(ev) {
  ev.preventDefault();
  const nombre = document.getElementById('campo-nombre-grado').value.trim();
  const errorEl = document.getElementById('error-form-grado');
  if (!nombre) { errorEl.innerHTML = mensajeError('Escribe el nombre del grado.'); return; }

  try {
    const nuevo = { id: generarId(), nombre };
    const resultado = await api('grados', { metodo: 'POST', accion: 'crear', datos: nuevo });
    if (!resultado.ok) { errorEl.innerHTML = mensajeError(resultado.error); return; }
    estado.grados = resultado.lista;
    if (!estado.gradoActivoCalendario && estado.grados.length > 0) {
      estado.gradoActivoCalendario = estado.grados[0].nombre;
    }
    estado.formGradoAbierto = false;
    render();
  } catch (e) { errorEl.innerHTML = mensajeError('Error al guardar grado.'); }
}

function pedirConfirmarEliminarGrado(id) {
  const g = estado.grados.find(x => x.id === id);
  if (!g) return;
  estado.confirmar = {
    mensaje: `¿Eliminar el grado "${g.nombre}"?`,
    accion: async () => {
      const resultado = await api('grados', { metodo: 'POST', accion: 'eliminar', datos: { id } });
      estado.grados = resultado.lista || [];
      if (estado.gradoActivoCalendario === g.nombre) {
        estado.gradoActivoCalendario = estado.grados.length > 0 ? estado.grados[0].nombre : '';
      }
    },
  };
  render();
}

/* ============================== ACTIVIDADES =============================== */
function abrirDia(fecha) { estado.diaSeleccionado = fecha; estado.formAbierto = false; actividadEnEdicion = null; render(); }
function cerrarDia() { estado.diaSeleccionado = null; estado.formAbierto = false; actividadEnEdicion = null; render(); }
function mostrarFormActividad(idActividad) {
  if (idActividad) {
    actividadEnEdicion = estado.actividades.find(a => a.id === idActividad);
  } else {
    actividadEnEdicion = null;
  }
  estado.formAbierto = true;
  render();
}
function ocultarFormActividad() { estado.formAbierto = false; actividadEnEdicion = null; render(); }

function alternarTipoActividad(tipo) {
  document.getElementById('campo-tipo').value = tipo;
  const btnEv = document.getElementById('btn-tipo-evento');
  const btnTar = document.getElementById('btn-tipo-tarea');
  if (btnEv) btnEv.classList.toggle('opcion-tipo-activa', tipo === 'evento');
  if (btnTar) btnTar.classList.toggle('opcion-tipo-activa', tipo === 'tarea');
  const bloque = document.getElementById('bloque-campos-tarea');
  if (bloque) bloque.style.display = tipo === 'tarea' ? '' : 'none';
}

async function manejarEnvioActividad(ev) {
  ev.preventDefault();
  const tipo = document.getElementById('campo-tipo').value;
  const titulo = document.getElementById('campo-titulo-actividad').value.trim();
  const materia = tipo === 'tarea' ? document.getElementById('campo-materia').value.trim() : '';
  const descripcion = document.getElementById('campo-descripcion-actividad').value.trim();
  const errorEl = document.getElementById('error-form-actividad');

  let curso = estado.gradoActivoCalendario;
  const globalCheckMaestros = document.getElementById('scope-maestros');
  const globalCheckTodos = document.getElementById('scope-todos');

  if (esRolGlobal(estado.sesion.rol)) {
    const esMaestros = globalCheckMaestros ? globalCheckMaestros.checked : false;
    const esTodos = globalCheckTodos ? globalCheckTodos.checked : false;
    if (esMaestros && esTodos) {
      curso = 'TODOS';
    } else if (esMaestros) {
      curso = 'Profesores';
    } else if (esTodos) {
      curso = 'TODOS';
    } else {
      curso = estado.gradoActivoCalendario;
    }
  }

  if (!titulo) { errorEl.innerHTML = mensajeError('Escribe un título.'); return; }
  if (tipo === 'tarea' && !curso) {
    errorEl.innerHTML = mensajeError('Debes seleccionar un grado activo.');
    return;
  }

  const actividadesActuales = actividadesUnidadActual();
  const estadoDiaReal = {
    eventos: actividadesActuales.filter(a => a.fecha === estado.diaSeleccionado && a.tipo === 'evento' && (!actividadEnEdicion || a.id !== actividadEnEdicion.id)),
    tareas: actividadesActuales.filter(a => a.fecha === estado.diaSeleccionado && a.tipo === 'tarea' && (!actividadEnEdicion || a.id !== actividadEnEdicion.id)),
  };
  estadoDiaReal.tieneEvento = estadoDiaReal.eventos.length > 0;
  estadoDiaReal.ocupadas = estadoDiaReal.tareas.length;
  estadoDiaReal.capacidad = estadoDiaReal.tieneEvento ? 2 : 5;

  const chequeo = puedeAgregar(tipo, estadoDiaReal);
  if (!chequeo.ok) { errorEl.innerHTML = mensajeError(chequeo.msg); return; }

  try {
    if (actividadEnEdicion) {
      const editada = Object.assign({}, actividadEnEdicion, { tipo, titulo, descripcion, materia, curso });
      const resultado = await api('actividades', { metodo: 'POST', accion: 'editar', datos: editada });
      estado.actividades = resultado.lista || estado.actividades;
    } else {
      const nueva = {
        id: generarId(), unidadId: estado.unidadActivaId, fecha: estado.diaSeleccionado,
        tipo, titulo, descripcion, materia, curso,
        rol: estado.sesion.rol, responsable: estado.sesion.nombre, creadoEn: Date.now(),
      };
      const resultado = await api('actividades', { metodo: 'POST', accion: 'crear', datos: nueva });
      estado.actividades = resultado.lista || estado.actividades;
    }
    estado.formAbierto = false;
    actividadEnEdicion = null;
    render();
  } catch (e) {
    errorEl.innerHTML = mensajeError('No se pudo guardar.');
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

function pedirConfirmarLimpiarActividades() {
  estado.confirmar = {
    mensaje: '¿Estás seguro de restablecer y borrar TODAS las actividades de prueba creadas en el sistema?',
    accion: async () => {
      const resultado = await api('actividades', { metodo: 'POST', accion: 'limpiar_todas' });
      estado.actividades = resultado.lista || [];
    }
  };
  render();
}

/* ============================== GESTIÓN DE USUARIOS =============================== */
function elegirRolNuevoUsuario(rol) {
  rolNuevoUsuario = rol;
  document.querySelectorAll('#form-usuario .opcion-rol').forEach(btn => {
    btn.classList.toggle('opcion-rol-activa', btn.dataset.rol === rol);
  });
}
function abrirFormUsuario(id) {
  if (id) {
    usuarioEnEdicion = estado.usuarios.find(u => u.id === id);
    rolNuevoUsuario = usuarioEnEdicion ? usuarioEnEdicion.rol : 'profesor';
  } else {
    usuarioEnEdicion = null;
    rolNuevoUsuario = 'profesor';
  }
  estado.formUsuarioAbierto = true;
  render();
}
function cerrarFormUsuario() { estado.formUsuarioAbierto = false; usuarioEnEdicion = null; render(); }

async function manejarEnvioUsuario(ev) {
  ev.preventDefault();
  const nombre = document.getElementById('campo-nombre-usuario').value.trim();
  const usuario = document.getElementById('campo-usuario-usuario').value.trim();
  const contrasena = document.getElementById('campo-contrasena-usuario').value;
  const errorEl = document.getElementById('error-form-usuario');

  if (!nombre || !usuario) { errorEl.innerHTML = mensajeError('Completa nombre y usuario.'); return; }
  if (!usuarioEnEdicion && contrasena.length < 4) { errorEl.innerHTML = mensajeError('Mínimo 4 caracteres para contraseña.'); return; }

  try {
    if (usuarioEnEdicion) {
      const datosEdit = { id: usuarioEnEdicion.id, nombre, usuario, contrasena, rol: rolNuevoUsuario };
      const resultado = await api('usuarios', { metodo: 'POST', accion: 'editar', datos: datosEdit });
      if (!resultado.ok) { errorEl.innerHTML = mensajeError(resultado.error); return; }
      estado.usuarios = resultado.lista;
    } else {
      const nuevo = { id: generarId(), nombre, usuario, contrasena, rol: rolNuevoUsuario };
      const resultado = await api('usuarios', { metodo: 'POST', accion: 'crear', datos: nuevo });
      if (!resultado.ok) { errorEl.innerHTML = mensajeError(resultado.error); return; }
      estado.usuarios = resultado.lista;
    }
    estado.formUsuarioAbierto = false;
    usuarioEnEdicion = null;
    render();
  } catch (e) { errorEl.innerHTML = mensajeError('Error al guardar usuario.'); }
}

function pedirConfirmarEliminarUsuario(id) {
  const u = estado.usuarios.find(x => x.id === id);
  if (!u) return;
  estado.confirmar = {
    mensaje: `¿Eliminar al usuario "${u.nombre}"?`,
    accion: async () => {
      const resultado = await api('usuarios', { metodo: 'POST', accion: 'eliminar', datos: { id } });
      estado.usuarios = resultado.lista || [];
    },
  };
  render();
}

async function alternarCierreCalendario() {
  const cerradoActual = estado.configuracion.calendarioCerrado === 'true';
  const nuevoValor = cerradoActual ? 'false' : 'true';
  estado.configuracion.calendarioCerrado = nuevoValor;
  await api('configuracion', { metodo: 'POST', datos: { calendarioCerrado: nuevoValor } });
  render();
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

/* ============================== RENDER PRINCIPAL =============================== */
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
        ${estado.vista === 'grados' ? plantillaGrados() : ''}
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
  ];
  if (estado.sesion.rol === 'admin') {
    items.push({ clave: 'unidades', label: 'Unidades', icono: 'book-open' });
  }
  items.push({ clave: 'reporte', label: 'Reporte', icono: 'printer' });

  if (estado.sesion.rol === 'admin') {
    items.push({ clave: 'grados', label: 'Grados', icono: 'graduation-cap' });
    items.push({ clave: 'usuarios', label: 'Usuarios', icono: 'key-round' });
  }
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
          <i data-lucide="${rol ? rol.icono : 'user'}"></i>
          <div>
            <p class="barra-usuario-nombre">${esc(estado.sesion.nombre)}</p>
            <p class="barra-usuario-rol">${rol ? rol.label : estado.sesion.rol}</p>
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

  if (estado.grados.length === 0) {
    return plantillaEstadoVacio('No hay grados configurados', estado.sesion.rol === 'admin' ? 'El administrador debe agregar los grados oficiales en la sección Grados.' : 'Pide a Administración que registre los grados del establecimiento.');
  }

  if (!estado.gradoActivoCalendario && estado.grados.length > 0) {
    estado.gradoActivoCalendario = estado.grados[0].nombre;
  }

  const opcionesGrados = estado.grados.map(g => `<option value="${esc(g.nombre)}"${estado.gradoActivoCalendario === g.nombre ? ' selected' : ''}>${esc(g.nombre)}</option>`).join('');

  const inicio = parseFecha(unidad.fechaInicio);
  const fin = parseFecha(unidad.fechaFin);
  const limiteAnterior = inicio.getFullYear() * 12 + inicio.getMonth();
  const limiteSiguiente = fin.getFullYear() * 12 + fin.getMonth();
  const actual = estado.mesActual.year * 12 + estado.mesActual.month;
  const semanas = getMatrizMes(estado.mesActual.year, estado.mesActual.month);
  const hoy = hoyStr();
  const actividadesUnidad = actividadesUnidadActual();
  const opcionesUnidad = unidadesOrdenadas().map(u => `<option value="${u.id}"${u.id === unidad.id ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('');
  const calendarioCerrado = estado.configuracion.calendarioCerrado === 'true';

  const filas = semanas.map(semana => `
    <div class="fila-semana">
      ${semana.map(d => {
        if (!d) return `<div class="celda-vacia"></div>`;
        const fechaStr = formatFecha(d);
        const activo = enRango(d, unidad.fechaInicio, unidad.fechaFin);
        if (!activo) return `<div class="celda-dia celda-inactiva"><span class="numero-dia">${d.getDate()}</span></div>`;
        
        const info = getEstadoDiaGrado(fechaStr, actividadesUnidad, estado.gradoActivoCalendario);
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
            <label class="etiqueta-inline">Unidad Activa</label>
            <select class="selector" onchange="seleccionarUnidadActiva(this.value)">${opcionesUnidad}</select>
          </div>
          <div>
            <label class="etiqueta-inline">Trabajando en Grado</label>
            <select class="selector" onchange="cambiarGradoActivoCalendario(this.value)">${opcionesGrados}</select>
          </div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          ${estado.sesion.rol === 'admin' ? `
            <button class="boton ${calendarioCerrado ? 'boton-secundario' : 'boton-peligro'}" onclick="alternarCierreCalendario()" title="${calendarioCerrado ? 'Habilitar ingresos' : 'Congelar ingresos y cerrar calendario'}">
              <i data-lucide="${calendarioCerrado ? 'unlock' : 'lock'}"></i> ${calendarioCerrado ? 'Calendario Cerrado' : 'Cerrar Calendario'}
            </button>
          ` : ''}
          <div class="nav-mes">
            <button class="boton-icono" onclick="cambiarMes(-1)"${actual <= limiteAnterior ? ' disabled' : ''}><i data-lucide="chevron-left"></i></button>
            <span class="nombre-mes">${MESES[estado.mesActual.month]} ${estado.mesActual.year}</span>
            <button class="boton-icono" onclick="cambiarMes(1)"${actual >= limiteSiguiente ? ' disabled' : ''}><i data-lucide="chevron-right"></i></button>
          </div>
        </div>
      </div>
      ${calendarioCerrado ? `<div style="background:#fef3c7;border:1px solid #f59e0b;padding:10px 16px;border-radius:8px;margin-bottom:16px;color:#92400e;font-size:13.5px;display:flex;align-items:center;gap:8px;"><i data-lucide="alert-triangle"></i> <b>Aviso:</b> El calendario está cerrado temporalmente por administración. No se permiten nuevos ingresos de actividades.</div>` : ''}

      <div class="tarjeta calendario-tarjeta">
        <div class="fila-dias-semana">${DIAS_CORTOS.map(d => `<div class="etiqueta-dia-semana">${d}</div>`).join('')}</div>
        ${filas}
      </div>

      <!-- Leyenda discreta de colores en la parte inferior -->
      <div class="leyenda-calendario" style="display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:20px;margin-top:16px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#64748b;">
        <div style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;background-color:#ffffff;border:1px solid #cbd5e1;border-radius:50%;"></span><span>Libre</span></div>
        <div style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;background-color:#f1f5f9;border:1px solid #94a3b8;border-radius:50%;"></span><span>Medio cargado</span></div>
        <div style="display:flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;background-color:#fee2e2;border:1px solid #f87171;border-radius:50%;"></span><span>Lleno (Límite alcanzado)</span></div>
        <div style="display:flex;align-items:center;gap:6px;"><i data-lucide="flag" style="width:12px;height:12px;color:#0f2b27;"></i><span>Evento Institucional</span></div>
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
  const info = getEstadoDiaGrado(estado.diaSeleccionado, actividadesActuales, estado.gradoActivoCalendario);
  const tipoFijo = TIPO_FIJO_POR_ROL[estado.sesion.rol];
  const items = info.delDiaVisible;
  const calendarioCerrado = estado.configuracion.calendarioCerrado === 'true';

  const itemsHtml = items.map(a => `
    <div class="item-actividad ${a.tipo === 'evento' ? 'item-evento' : 'item-tarea'}">
      <div class="item-icono"><i data-lucide="${a.tipo === 'evento' ? 'flag' : 'book-open'}" style="width:15px;height:15px"></i></div>
      <div class="item-cuerpo">
        <p class="item-titulo">${esc(a.titulo)} ${a.curso ? `<span style="font-size:11px;background:#e2e8f0;padding:2px 6px;border-radius:4px;">${esc(a.curso)}</span>` : ''}</p>
        ${a.tipo === 'tarea' && a.materia ? `<p class="item-meta">Materia: ${esc(a.materia)}</p>` : ''}
        ${a.descripcion ? `<p class="item-descripcion">${esc(a.descripcion)}</p>` : ''}
        <p class="item-responsable">${ROLES[a.rol] ? ROLES[a.rol].label : esc(a.rol)} · ${esc(a.responsable)}</p>
      </div>
      <div style="display:flex;gap:4px;">
        ${(puedeEliminarActividad(a) && !calendarioCerrado) ? `
          <button class="item-eliminar" onclick="mostrarFormActividad('${a.id}')" title="Editar"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
          <button class="item-eliminar" onclick="pedirConfirmarEliminarActividad('${a.id}')" title="Eliminar"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
        ` : ''}
      </div>
    </div>`).join('');

  let cuerpoAgregar = '';
  if (calendarioCerrado) {
    cuerpoAgregar = `<p style="text-align:center;color:var(--tinta-suave);font-size:13px;padding:8px;">Calendario cerrado para nuevos ingresos.</p>`;
  } else {
    cuerpoAgregar = estado.formAbierto ? plantillaFormActividad(tipoFijo) : `<button class="boton boton-secundario boton-ancho" onclick="mostrarFormActividad(null)"><i data-lucide="plus"></i> Agregar actividad para ${esc(estado.gradoActivoCalendario)}</button>`;
  }

  return `
    <div class="superposicion" onclick="cerrarDia()">
      <div class="panel" onclick="event.stopPropagation()">
        <div class="panel-encabezado">
          <div>
            <p class="panel-fecha">${formatFechaLarga(estado.diaSeleccionado)}</p>
            <p class="panel-cupo">Grado activo: <b>${esc(estado.gradoActivoCalendario)}</b></p>
          </div>
          <button class="boton-icono" onclick="cerrarDia()"><i data-lucide="x"></i></button>
        </div>
        <div class="panel-cuerpo">
          ${items.length === 0 && !estado.formAbierto ? `<p class="panel-sin-actividades">No hay actividades visibles para este grado en este día.</p>` : ''}
          ${itemsHtml}
          ${cuerpoAgregar}
        </div>
      </div>
    </div>`;
}

function plantillaFormActividad(tipoFijo) {
  const tipoInicial = actividadEnEdicion ? actividadEnEdicion.tipo : (tipoFijo || 'tarea');
  const esGlobal = esRolGlobal(estado.sesion.rol);

  const selectorTipo = (tipoFijo === null || esGlobal) ? `
    <div class="selector-tipo">
      <button type="button" id="btn-tipo-evento" class="opcion-tipo${tipoInicial === 'evento' ? ' opcion-tipo-activa' : ''}" onclick="alternarTipoActividad('evento')"><i data-lucide="flag"></i> Evento</button>
      <button type="button" id="btn-tipo-tarea" class="opcion-tipo${tipoInicial === 'tarea' ? ' opcion-tipo-activa' : ''}" onclick="alternarTipoActividad('tarea')"><i data-lucide="book-open"></i> Tarea</button>
    </div>` : '';

  let selectorAlcanceGlobal = '';
  if (esGlobal) {
    const cursoActual = actividadEnEdicion ? (actividadEnEdicion.curso || '') : '';
    const checkMaestrosChecked = cursoActual === 'Profesores' || cursoActual === 'TODOS';
    const checkTodosChecked = cursoActual === 'TODOS' || cursoActual === '';

    selectorAlcanceGlobal = `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:8px;margin-bottom:12px;">
        <label class="etiqueta" style="margin-bottom:6px;display:block;">¿A quién va dirigido?</label>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;">
            <input type="checkbox" id="scope-maestros"${checkMaestrosChecked ? ' checked' : ''}> Solo Maestros (Calendario exclusivo profesores)
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13.5px;cursor:pointer;">
            <input type="checkbox" id="scope-todos"${checkTodosChecked ? ' checked' : ''}> Todos los Alumnos (General para todos los grados)
          </label>
        </div>
        <small style="color:#64748b;display:block;margin-top:6px;">Puedes marcar ambos si la actividad aplica tanto para profesores como para todos los alumnos.</small>
      </div>`;
  }

  return `
    <form class="form-actividad" onsubmit="manejarEnvioActividad(event)">
      ${selectorTipo}
      <input type="hidden" id="campo-tipo" value="${tipoInicial}">
      ${selectorAlcanceGlobal}
      <label class="etiqueta">Título</label>
      <input class="campo" id="campo-titulo-actividad" value="${actividadEnEdicion ? esc(actividadEnEdicion.titulo) : ''}" placeholder="Nombre de la actividad">
      <div id="bloque-campos-tarea" style="${tipoInicial === 'tarea' ? '' : 'display:none'}">
        <label class="etiqueta">Materia</label>
        <input class="campo" id="campo-materia" value="${actividadEnEdicion ? esc(actividadEnEdicion.materia) : ''}" placeholder="Ej. Matemática">
        ${!esGlobal ? `<p style="font-size:11.5px;color:#52655f;margin-top:4px;">Asignado al grado: <b>${esc(estado.gradoActivoCalendario)}</b></p>` : ''}
      </div>
      <label class="etiqueta">Detalle o instrucciones</label>
      <textarea class="campo campo-textarea" id="campo-descripcion-actividad" rows="3">${actividadEnEdicion ? esc(actividadEnEdicion.descripcion) : ''}</textarea>
      <div id="error-form-actividad"></div>
      <div class="fila-botones">
        <button type="button" class="boton boton-fantasma" onclick="ocultarFormActividad()">Cancelar</button>
        <button type="submit" class="boton boton-primario">${actividadEnEdicion ? 'Actualizar' : 'Guardar'}</button>
      </div>
    </form>`;
}

/* ============================== UNIDADES =============================== */
function plantillaUnidades() {
  if (estado.sesion.rol !== 'admin') return plantillaEstadoVacio('Acceso Restringido', 'Solo el administrador del sistema puede gestionar las unidades.');
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

  const botonLimpiar = `
    <div style="margin-top:24px;border-top:1px solid var(--borde);padding-top:20px;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <h4 style="font-size:15px;color:var(--tinta);">Depuración de Actividades de Prueba</h4>
        <p style="font-size:13px;color:var(--tinta-suave);">Borra todas las actividades creadas para dejar el sistema limpio antes de producción.</p>
      </div>
      <button class="boton boton-peligro" onclick="pedirConfirmarLimpiarActividades()"><i data-lucide="trash-2"></i> Limpiar todas las actividades</button>
    </div>`;

  return `
    <div class="vista">
      <div class="vista-encabezado">
        <div><h2 class="titulo-vista">Gestión de Unidades</h2></div>
        <button class="boton boton-primario" onclick="abrirFormUnidad(null)"><i data-lucide="plus"></i> Nueva unidad</button>
      </div>
      ${formHtml}
      <div class="lista-unidades">${ordenadas.map(u => `
        <div class="tarjeta-unidad">
          <button class="tarjeta-unidad-cuerpo" onclick="seleccionarUnidadActiva('${u.id}')">
            <p class="tarjeta-unidad-nombre">${esc(u.nombre)}</p>
            <p class="tarjeta-unidad-rango">${formatFechaCorta(u.fechaInicio)} — ${formatFechaCorta(u.fechaFin)}</p>
          </button>
          <div class="tarjeta-unidad-acciones"><button class="boton-icono" onclick="abrirFormUnidad('${u.id}')"><i data-lucide="pencil"></i></button><button class="boton-icono boton-icono-peligro" onclick="pedirConfirmarEliminarUnidad('${u.id}')"><i data-lucide="trash-2"></i></button></div>
        </div>`).join('')}</div>
      ${botonLimpiar}
    </div>`;
}

/* ============================== SECCIÓN GRADOS (ADMIN) =============================== */
function plantillaGrados() {
  if (estado.sesion.rol !== 'admin') return '';
  const formHtml = estado.formGradoAbierto ? `
    <form class="tarjeta form-unidad" onsubmit="manejarEnvioGrado(event)">
      <label class="etiqueta">Nombre del grado</label>
      <input class="campo" id="campo-nombre-grado" placeholder="Ej. Cuarto Bachillerato o Profesores">
      <div id="error-form-grado"></div>
      <div class="fila-botones">
        <button type="button" class="boton boton-fantasma" onclick="cerrarFormGrado()">Cancelar</button>
        <button type="submit" class="boton boton-primario">Guardar grado</button>
      </div>
    </form>` : '';

  return `
    <div class="vista">
      <div class="vista-encabezado">
        <div>
          <h2 class="titulo-vista">Grados del Establecimiento</h2>
          <p class="subtitulo-vista">Gestiona la lista oficial de cursos y grados (incluyendo "Profesores").</p>
        </div>
        <button class="boton boton-primario" onclick="abrirFormGrado()"><i data-lucide="plus"></i> Nuevo grado</button>
      </div>
      ${formHtml}
      <div class="lista-unidades">
        ${estado.grados.length === 0 && !estado.formGradoAbierto ? `<p style="color:var(--tinta-suave);padding:10px;">No hay grados registrados todavía.</p>` : ''}
        ${estado.grados.map(g => `
          <div class="tarjeta-unidad">
            <div class="tarjeta-unidad-cuerpo" style="cursor:default;">
              <p class="tarjeta-unidad-nombre">${esc(g.nombre)}</p>
            </div>
            <div class="tarjeta-unidad-acciones">
              <button class="boton-icono boton-icono-peligro" onclick="pedirConfirmarEliminarGrado('${g.id}')" title="Eliminar"><i data-lucide="trash-2"></i></button>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

/* ============================== USUARIOS =============================== */
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
        <button class="boton boton-primario" onclick="abrirFormUsuario(null)"><i data-lucide="plus"></i> Nuevo usuario</button>
      </div>
      ${estado.formUsuarioAbierto ? `
        <form class="tarjeta form-unidad" id="form-usuario" onsubmit="manejarEnvioUsuario(event)">
          <label class="etiqueta">Nombre</label><input class="campo" id="campo-nombre-usuario" value="${usuarioEnEdicion ? esc(usuarioEnEdicion.nombre) : ''}">
          <div class="fila-campos">
            <div><label class="etiqueta">Usuario</label><input class="campo" id="campo-usuario-usuario" value="${usuarioEnEdicion ? esc(usuarioEnEdicion.usuario) : ''}"></div>
            <div><label class="etiqueta">Contraseña ${usuarioEnEdicion ? '(dejar en blanco para mantener)' : ''}</label><input class="campo" type="password" id="campo-contrasena-usuario"></div>
          </div>
          <label class="etiqueta">Rol / Categoría</label>
          <div class="selector-roles">${opcionesRol}</div>
          <div id="error-form-usuario"></div>
          <div class="fila-botones"><button type="button" class="boton boton-fantasma" onclick="cerrarFormUsuario()">Cancelar</button><button type="submit" class="boton boton-primario">${usuarioEnEdicion ? 'Actualizar' : 'Crear'}</button></div>
        </form>` : ''}
      <div class="lista-unidades">${estado.usuarios.map(u => `
        <div class="tarjeta-unidad" style="flex-direction:column;">
          <div style="display:flex;width:100%;">
            <div class="tarjeta-unidad-cuerpo"><p class="tarjeta-unidad-nombre">${esc(u.nombre)}</p><p class="tarjeta-unidad-rango">usuario: ${esc(u.usuario)} · ${ROLES[u.rol]?.label || u.rol}</p></div>
            <div class="tarjeta-unidad-acciones">
              <button class="boton-icono" onclick="abrirFormUsuario('${u.id}')" title="Editar"><i data-lucide="pencil"></i></button>
              <button class="boton-icono" onclick="mostrarFormRestablecer('${u.id}')" title="Cambiar clave"><i data-lucide="key-round"></i></button>
              <button class="boton-icono boton-icono-peligro" onclick="pedirConfirmarEliminarUsuario('${u.id}')" title="Eliminar"><i data-lucide="trash-2"></i></button>
            </div>
          </div>
          <div id="restablecer-${u.id}" style="display:none;padding:10px;">
            <div class="fila-campos"><input class="campo" type="password" id="campo-nueva-clave-${u.id}" placeholder="Nueva clave"><button class="boton boton-secundario" onclick="restablecerContrasena('${u.id}')">Cambiar</button></div>
          </div>
        </div>`).join('')}</div>
    </div>`;
}

async function restablecerContrasena(id) {
  const input = document.getElementById(`campo-nueva-clave-${id}`);
  const nueva = input.value;
  if (nueva.length < 4) return;
  await api('usuarios', { metodo: 'POST', accion: 'restablecer', datos: { id, contrasena: nueva } });
  input.value = '';
  const el = document.getElementById(`restablecer-${id}`);
  if (el) el.style.display = 'none';
}
function mostrarFormRestablecer(id) {
  const el = document.getElementById(`restablecer-${id}`);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

/* ============================== REPORTE =============================== */
function plantillaReporte() {
  if (!estado.unidades.length) return plantillaEstadoVacio('Sin unidades', 'No hay unidades registradas.');

  const opcionesUnidad = `<option value="" disabled ${!estado.unidadReporteId ? 'selected' : ''}>Seleccione una unidad...</option>` +
    `<option value="todas"${estado.unidadReporteId === 'todas' ? ' selected' : ''}>Todas las unidades (General)</option>` +
    unidadesOrdenadas().map(u => `<option value="${u.id}"${u.id === estado.unidadReporteId ? ' selected' : ''}>${esc(u.nombre)}</option>`).join('');

  const opcionesGrados = `<option value="" disabled ${!estado.gradoFiltroReporte ? 'selected' : ''}>Seleccione destino...</option>` +
    `<option value="TODOS"${estado.gradoFiltroReporte === 'TODOS' ? ' selected' : ''}>Todos los grados (General)</option>` +
    estado.grados.map(g => `<option value="${esc(g.nombre)}"${estado.gradoFiltroReporte === g.nombre ? ' selected' : ''}>${esc(g.nombre)}</option>`).join('');

  let items = [];
  let unidadSeleccionadaTexto = '';
  let gradoSeleccionadoTexto = estado.gradoFiltroReporte || '';

  if (estado.unidadReporteId && estado.gradoFiltroReporte) {
    if (estado.unidadReporteId === 'todas') {
      unidadSeleccionadaTexto = 'Todas las unidades';
      items = estado.actividades.filter(a => {
        if (estado.gradoFiltroReporte === 'TODOS') return true;
        if (!a.curso || a.curso === 'TODOS') return true;
        return a.curso.trim().toLowerCase() === estado.gradoFiltroReporte.trim().toLowerCase();
      });
    } else {
      const uObj = estado.unidades.find(x => x.id === estado.unidadReporteId);
      unidadSeleccionadaTexto = uObj ? uObj.name || uObj.nombre : '';
      items = estado.actividades.filter(a => {
        if (a.unidadId !== estado.unidadReporteId) return false;
        if (estado.gradoFiltroReporte === 'TODOS') return true;
        if (!a.curso || a.curso === 'TODOS') return true;
        return a.curso.trim().toLowerCase() === estado.gradoFiltroReporte.trim().toLowerCase();
      });
    }
    items.sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  const nombreColegio = estado.configuracion.nombreColegio || '';
  const esAdmin = estado.sesion.rol === 'admin';

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
        <div><h2 class="titulo-vista">Reporte por Grado o Calendario</h2></div>
        <button class="boton boton-primario" onclick="window.print()"><i data-lucide="printer"></i> Imprimir / PDF</button>
      </div>

      <div class="controles-reporte no-imprimir" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;align-items:flex-end;">
        <div><label class="etiqueta">Unidad a reportar</label><select class="selector" onchange="cambiarUnidadReporte(this.value)">${opcionesUnidad}</select></div>
        <div><label class="etiqueta">Seleccionar Destino</label><select class="selector" onchange="cambiarGradoReporte(this.value)">${opcionesGrados}</select></div>
        ${esAdmin ? `<div><label class="etiqueta">Establecimiento</label><input class="campo" value="${esc(nombreColegio)}" onchange="guardarNombreColegio(this)"></div>` : ''}
      </div>

      ${(!estado.unidadReporteId || !estado.gradoFiltroReporte) ? `
        <div class="tarjeta" style="text-align:center;padding:40px;color:var(--tinta-suave);">
          <i data-lucide="printer" style="width:36px;height:36px;margin-bottom:8px;opacity:0.5;"></i>
          <p>Selecciona una <b>Unidad</b> y un <b>Destino</b> en los selectores superiores para generar el reporte.</p>
        </div>
      ` : `
      <div class="hoja-reporte">
        <div class="reporte-encabezado">
          <p class="reporte-colegio">${esc(nombreColegio)}</p>
          <h1 class="reporte-titulo">Plan de Actividades</h1>
          <p class="reporte-unidad">${esc(unidadSeleccionadaTexto)} – ${esc(gradoSeleccionadoTexto)}</p>
        </div>
        ${items.length === 0 ? `<p class="reporte-vacio">No hay actividades registradas para esta selección.</p>` : `
          <table class="tabla-reporte">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Actividad</th><th>Detalle</th><th>Responsable</th></tr></thead>
            <tbody>${filasTabla}</tbody>
          </table>`}
      </div>`}
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
        <div class="fila-botones"><button class="boton boton-fantasma" onclick="cancelarConfirmacion()">Cancelar</button><button class="boton boton-peligro" onclick="ejecutarConfirmacion()">Aceptar</button></div>
      </div>
    </div>`;
}

document.addEventListener('DOMContentLoaded', iniciar);
