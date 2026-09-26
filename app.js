// [Reemplazar en app.js dentro de la función que renderiza las celdas del calendario]
function renderizarDias(year, month) {
  // ... (mantener la estructura anterior de obtención de semanas y datos)
  const filas = semanas.map(semana => `
    <div class="fila-semana">
      ${semana.map(d => {
        if (!d) return `<div class="celda-vacia"></div>`;
        const fechaStr = formatFecha(d);
        const activo = enRango(d, unidad.fechaInicio, unidad.fechaFin);
        if (!activo) return `<div class="celda-dia celda-inactiva"><span class="numero-dia">${d.getDate()}</span></div>`;
        
        const info = getEstadoDiaGrado(fechaStr, actividadesUnidad, estado.gradoActivoCalendario);
        
        // Vista previa de actividades dentro de la celda (máximo 3 visibles para no saturar)
        let htmlPreview = '';
        const itemsPreview = info.delDiaVisible.slice(0, 3);
        itemsPreview.forEach(item => {
          let textoItem = '';
          if (item.tipo === 'evento') {
            textoItem = esc(item.titulo);
          } else {
            let nombreGradoCorto = item.curso ? esc(item.curso) : '';
            textoItem = `${nombreGradoCorto}:${esc(item.titulo)}`;
          }
          htmlPreview += `<div class="preview-item preview-${item.tipo}" draggable="true" ondragstart="event.stopPropagation(); event.dataTransfer.setData('text/plain', '${item.id}')" title="${esc(item.titulo)}">${textoItem}</div>`;
        });
        if (info.delDiaVisible.length > 3) {
          htmlPreview += `<div class="preview-mas">+${info.delDiaVisible.length - 3} más</div>`;
        }

        return `
          <div class="celda-dia celda-${info.estado}${fechaStr === hoy ? ' celda-hoy' : ''}" 
               onclick="abrirDia('${fechaStr}')"
               ondragover="event.preventDefault()"
               ondrop="event.preventDefault(); moverActividadPorDragDrop('${fechaStr}')">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
              <span class="numero-dia">${d.getDate()}</span>${(info.ocupadas > 0 || info.tieneEvento) ? `<span class="conteo-dia">${info.ocupadas}/${info.capacidad}</span>` : ''}
            </div>
            ${info.tieneEvento ? `<i data-lucide="flag" class="marca-evento" style="width:11px;height:11px"></i>` : ''}
            <div class="contenedor-preview-dia">
              ${htmlPreview}
            </div>
          </div>`;
      }).join('')}
    </div>`).join('');
  return filas;
}

// Función auxiliar para procesar el soltar (drag and drop) de una actividad a otro día
async function moverActividadPorDragDrop(nuevaFecha) {
  const idActividad = window.idActividadArrastrada;
  if (!idActividad) return;
  
  const actividad = estado.actividades.find(a => a.id === idActividad);
  if (!actividad) return;
  
  if (actividad.fecha === nuevaFecha) return; // Mismo día, no hacer nada

  // Validar capacidad si es tarea
  const actividadesActuales = actividadesUnidadActual();
  const estadoDiaReal = {
    eventos: actividadesActuales.filter(a => a.fecha === nuevaFecha && a.tipo === 'evento' && a.id !== idActividad),
    tareas: actividadesActuales.filter(a => a.fecha === nuevaFecha && a.tipo === 'tarea' && a.id !== idActividad),
  };
  estadoDiaReal.tieneEvento = estadoDiaReal.eventos.length > 0;
  estadoDiaReal.ocupadas = estadoDiaReal.tareas.length;
  estadoDiaReal.capacidad = estadoDiaReal.tieneEvento ? 2 : 5;

  const chequeo = puedeAgregar(actividad.tipo, estadoDiaReal);
  if (!chequeo.ok) {
    alert(chequeo.msg);
    return;
  }

  try {
    const actModificada = Object.assign({}, actividad, { fecha: nuevaFecha });
    const resultado = await api('actividades', { metodo: 'POST', accion: 'editar', datos: actModificada });
    estado.actividades = resultado.lista || estado.actividades;
    render();
  } catch (e) {
    alert("No se pudo mover la actividad.");
  }
}

// Capturar el ID al iniciar el arrastre
document.addEventListener('dragstart', (e) => {
  if (e.target && e.target.getAttribute('ondragstart')) {
    // Extraemos el ID del atributo o de un data attribute auxiliar si se prefiere
  }
});
