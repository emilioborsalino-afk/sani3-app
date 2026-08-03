if(window.MODO_EMPLEADO){
  document.body.classList.add('modo-empleado');
}

const BACKEND_URL_KEY = 'sani3_backend_url';

let backendUrl = '';
let clients = [];
let records = [];
let config = { companyName: 'Sani3' };
let ubicacionActual = null;      // {lat, lon} de la última vez que se consiguió bien
let obsFotosTemp = {};           // fotos de observación ya procesadas, esperando a que se guarden
let ubicacionActualHora = null;  // Date de cuándo se consiguió

const CLIENTES_PRECARGADOS = []; // ya no se usa: los clientes se leen en vivo desde Registro Alquileres

function todayLabel(){
  const d = new Date();
  document.getElementById('todayLabel').textContent = d.toLocaleDateString('es-AR', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
}

function setStatus(msg, type){
  const el = document.getElementById('statusLine');
  el.textContent = msg;
  el.className = 'status-line' + (type ? ' ' + type : '');
}
function setConnStatus(msg, type){
  const el = document.getElementById('connStatus');
  el.textContent = msg;
  el.className = 'status-line' + (type ? ' ' + type : '');
}
function setConnDot(ok){
  document.getElementById('connDot').className = 'conn-dot' + (ok ? ' ok' : '');
  document.getElementById('connLabel').textContent = ok ? 'Conectado al backend' : 'Sin conectar al backend';
}

function showFatalError(msg){
  const banner = document.getElementById('fatalErrorBanner');
  banner.textContent = 'Error: ' + msg;
  banner.style.display = 'block';
}
window.addEventListener('error', (e)=>{ showFatalError(e.message); });
window.addEventListener('unhandledrejection', (e)=>{
  showFatalError(e.reason && e.reason.message ? e.reason.message : String(e.reason));
});

// ---------- Llamadas al backend (Google Apps Script) ----------

async function backendGet(action){
  if(!backendUrl) throw new Error('Todavía no conectaste el backend (pegá la URL arriba).');
  const res = await fetch(backendUrl + '?action=' + encodeURIComponent(action));
  const data = await res.json();
  if(data && data.error) throw new Error(data.error);
  return data;
}
async function backendPost(payload){
  if(!backendUrl) throw new Error('Todavía no conectaste el backend (pegá la URL arriba).');
  const res = await fetch(backendUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if(data && data.error) throw new Error(data.error);
  return data;
}

async function loadAll(){
  document.getElementById('companyName').value = config.companyName || '';
  if(!backendUrl){
    setConnDot(false);
    renderClientSelect();
    renderClientList();
    renderHistory();
    return;
  }
  try{
    config = await backendGet('config');
    document.getElementById('companyName').value = config.companyName || '';

    clients = await backendGet('clients');
    records = await backendGet('records');

    setConnDot(true);
    setConnStatus('Conectado. ' + clients.length + ' clientes, ' + records.length + ' servicios en el historial.', 'ok');
  }catch(err){
    setConnDot(false);
    setConnStatus('Error al conectar: ' + err.message, 'err');
  }
  renderClientSelect();
  renderClientList();
  renderHistory();
}

document.getElementById('companyName').addEventListener('change', async (e)=>{
  config.companyName = e.target.value;
  try{ await backendPost({ action:'setConfig', companyName: config.companyName }); }
  catch(err){ setStatus('No se pudo guardar el nombre: ' + err.message, 'err'); }
});

document.getElementById('saveBackendUrlBtn').onclick = async ()=>{
  const val = document.getElementById('backendUrlInput').value.trim();
  if(!val){ setConnStatus('Pegá la URL primero.', 'err'); return; }
  backendUrl = val;
  localStorage.setItem(BACKEND_URL_KEY, backendUrl);
  setConnStatus('Conectando...');
  await loadAll();
};

document.getElementById('refreshBtn').onclick = async ()=>{
  setStatus('Actualizando...');
  await loadAll();
  setStatus('Historial actualizado.', 'ok');
};

// ---------- Clientes ----------

const DIAS_CANON = ['Lunes','Martes','Miercoles','Jueves','Viernes','Sabado'];
function normalizar(s){
  return (s||'').toLowerCase()
    .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i').replace(/ó/g,'o').replace(/ú/g,'u');
}
const PREFIJOS_DIA = { 'Lunes':'lun', 'Martes':'mar', 'Miercoles':'mie', 'Jueves':'jue', 'Viernes':'vie', 'Sabado':'sab' };
function diasDeCliente(c){
  const dia = normalizar(c.dia);
  const encontrados = DIAS_CANON.filter(d => dia.indexOf(PREFIJOS_DIA[d]) !== -1);
  return encontrados.length ? encontrados : ['Otros'];
}

function inicioSemanaActual(){
  // Lunes 00:00 de esta semana
  const hoy = new Date();
  const diaSemana = hoy.getDay(); // 0=domingo, 1=lunes, ...
  const diasDesdeElLunes = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - diasDesdeElLunes);
  lunes.setHours(0,0,0,0);
  return lunes;
}

function hechoEstaSemana(nombreCliente){
  const inicio = inicioSemanaActual();
  return records.some(r => r.cliente === nombreCliente && new Date(r.fechaISO) >= inicio);
}

let selectedClientIndex = null;

function updateSelectedLabel(){
  const label = document.getElementById('selectedClientLabel');
  const c = (selectedClientIndex != null) ? clients[selectedClientIndex] : null;
  if(!c){
    label.textContent = 'Ningún cliente elegido todavía';
    label.style.color = '#8A9793';
  } else {
    label.textContent = 'Elegido: ' + c.nombre + (c.direccion ? ' — ' + c.direccion : '');
    label.style.color = 'var(--teal-deep)';
  }
}

function renderClientSelect(){
  const wrap = document.getElementById('clientAccordion');
  wrap.innerHTML = '';
  const registerBtn = document.getElementById('registerBtn');

  if(clients.length === 0){
    wrap.innerHTML = '<div class="empty" style="padding:16px 0;">Agregá un cliente abajo primero.</div>';
    registerBtn.dataset.disabled = 'true';
    registerBtn.classList.add('disabled-look');
    selectedClientIndex = null;
    updateSelectedLabel();
    return;
  }

  // si el cliente elegido ya no existe (se quitó, o se recargó la lista), lo soltamos
  if(selectedClientIndex != null && !clients[selectedClientIndex]) selectedClientIndex = null;

  const grupos = {};
  DIAS_CANON.concat(['Otros']).forEach(d => grupos[d] = []);
  clients.forEach((c, i)=>{
    diasDeCliente(c).forEach(d => grupos[d].push(i));
  });

  DIAS_CANON.concat(['Otros']).forEach(d=>{
    if(grupos[d].length === 0) return;

    const section = document.createElement('div');
    section.style.cssText = 'border:1px solid var(--line); border-radius:8px; margin-top:8px; overflow:hidden;';

    const header = document.createElement('button');
    header.type = 'button';
    header.style.cssText = 'width:100%; text-align:left; background:var(--teal); color:#fff; padding:12px 14px; font-family:var(--disp); font-weight:700; font-size:15px; border:none; display:flex; justify-content:space-between; align-items:center; cursor:pointer;';
    const label = document.createElement('span');
    label.textContent = (d === 'Otros' ? 'Otros / agregados a mano' : d) + ` (${grupos[d].length})`;
    const arrow = document.createElement('span');
    arrow.textContent = '▾';
    arrow.className = 'acc-arrow';
    header.appendChild(label);
    header.appendChild(arrow);

    const body = document.createElement('div');
    body.className = 'acc-body';
    body.style.cssText = 'display:none; background:#fff;';

    grupos[d].forEach(i=>{
      const c = clients[i];
      const item = document.createElement('div');
      item.dataset.idx = i;
      item.style.cssText = 'display:flex; align-items:stretch; border-top:1px solid var(--line); background:' + (selectedClientIndex===i ? '#E3ECEA' : '#fff') + ';';

      const btnInfo = document.createElement('button');
      btnInfo.type = 'button';
      btnInfo.style.cssText = 'flex:1; text-align:left; padding:12px 14px; border:none; background:none; font-family:var(--body); font-size:14.5px; color:var(--ink); cursor:pointer;';
      const check = hechoEstaSemana(c.nombre) ? ' <span style="color:var(--green); font-weight:700;">✓ hecho esta semana</span>' : '';
      btnInfo.innerHTML = (c.direccion
        ? `<strong>${escapeHtml(c.nombre)}</strong><br><span style="color:#8A9793; font-size:12.5px;">${escapeHtml(c.direccion)}</span>`
        : `<strong>${escapeHtml(c.nombre)}</strong>`) + check;
      btnInfo.onclick = ()=>{
        selectedClientIndex = i;
        updateSelectedLabel();
        wrap.querySelectorAll('[data-idx]').forEach(el=> el.style.background = '#fff');
        item.style.background = '#E3ECEA';
        registerBtn.dataset.disabled = 'false';
        registerBtn.classList.remove('disabled-look');
        // colapsamos todo despues de elegir, para que quede prolijo
        wrap.querySelectorAll('.acc-body').forEach(b=>b.style.display='none');
        wrap.querySelectorAll('.acc-arrow').forEach(a=>a.textContent='▾');
      };
      item.appendChild(btnInfo);

      const btnMapa = document.createElement('button');
      btnMapa.type = 'button';
      btnMapa.style.cssText = 'flex-shrink:0; width:46px; border:none; border-left:1px solid var(--line); background:none; font-size:18px; cursor:pointer;';
      if(c.ubicacionFija){
        btnMapa.title = 'Ir a la ubicación de este baño';
        btnMapa.textContent = '📍';
        btnMapa.onclick = (e)=>{
          e.stopPropagation();
          window.open(c.ubicacionFija, '_blank');
        };
      } else {
        btnMapa.title = 'Todavía no tiene ubicación fija cargada — tocá para abrir Maps y buscarla';
        btnMapa.style.opacity = '0.4';
        btnMapa.textContent = '📍';
        btnMapa.onclick = (e)=>{
          e.stopPropagation();
          window.open('https://www.google.com/maps', '_blank');
          setStatus(`"${c.nombre}" todavía no tenía ubicación fija — te abrí Maps para que la busques. Después compartila desde ahí (Compartir → Sani3 → "La ubicación fija de un baño") para que quede guardada.`, 'ok');
        };
      }
      item.appendChild(btnMapa);

      body.appendChild(item);
    });

    header.onclick = ()=>{
      const isOpen = body.style.display === 'block';
      wrap.querySelectorAll('.acc-body').forEach(b=>b.style.display='none');
      wrap.querySelectorAll('.acc-arrow').forEach(a=>a.textContent='▾');
      body.style.display = isOpen ? 'none' : 'block';
      arrow.textContent = isOpen ? '▾' : '▴';
    };

    section.appendChild(header);
    section.appendChild(body);
    wrap.appendChild(section);
  });

  registerBtn.dataset.disabled = (selectedClientIndex == null) ? 'true' : 'false';
  registerBtn.classList.toggle('disabled-look', selectedClientIndex == null);
  updateSelectedLabel();
}


function crearFilaCliente(c, i){
  const div = document.createElement('div');
  div.className = 'client-chip';
  const label = c.direccion ? `${escapeHtml(c.nombre)} <span style="color:#8A9793;">— ${escapeHtml(c.direccion)}</span>` : escapeHtml(c.nombre);
  div.innerHTML = `<span>${label}</span>`;

  const acciones = document.createElement('div');
  acciones.style.cssText = 'display:flex; gap:10px; align-items:center; flex-shrink:0;';

  const btnLink = document.createElement('button');
  btnLink.textContent = 'Copiar link';
  btnLink.style.cssText = 'background:none; color:#B5711A; font-family:var(--body); font-weight:600; font-size:13px; padding:2px;';
  btnLink.onclick = async ()=>{
    const url = new URL('cliente.html', location.href);
    const tieneHuellaEstable = c.fechaInicio && c.telefono;

    let nombres = [c.nombre];
    if(!tieneHuellaEstable){
      // Sin fecha de inicio + teléfono no hay forma confiable de vincular solo,
      // así que preguntamos por nombres anteriores como respaldo.
      const anteriores = prompt(
        '¿Este cliente tuvo algún nombre anterior en tu planilla (por ejemplo, si le corregiste el nombre)?\n\nSi tuvo, escribilo acá (si fueron varios, separalos con coma). Si no tuvo, dejá vacío y tocá Aceptar.',
        ''
      );
      if(anteriores === null) return; // canceló
      nombres = nombres.concat(anteriores.split(',').map(n=>n.trim()).filter(Boolean));
    }

    url.searchParams.set('nombre', nombres.join('|'));
    if(c.direccion) url.searchParams.set('direccion', c.direccion);
    if(c.fechaInicio) url.searchParams.set('fechaInicio', c.fechaInicio);
    if(c.telefono) url.searchParams.set('telefono', c.telefono);

    try{
      await navigator.clipboard.writeText(url.toString());
      setStatus('Link de ' + c.nombre + ' copiado. Pegalo en WhatsApp para mandárselo.', 'ok');
    }catch(err){
      prompt('Copiá este link a mano:', url.toString());
    }
  };

  const btnQuitar = document.createElement('button');
  btnQuitar.textContent = 'Quitar';
  btnQuitar.onclick = async ()=>{
    const ok = confirm('¿Seguro que querés quitar a "' + c.nombre + '" de la lista de clientes?');
    if(!ok) return;
    try{
      await backendPost({ action:'deleteClient', nombre: c.nombre, direccion: c.direccion || '' });
      const idx = clients.indexOf(c);
      if(idx !== -1) clients.splice(idx,1);
      renderClientSelect();
      renderClientList();
      setStatus('Cliente quitado: ' + c.nombre, 'ok');
    }catch(err){ setStatus('No se pudo quitar: ' + err.message, 'err'); }
  };

  acciones.appendChild(btnLink);
  acciones.appendChild(btnQuitar);
  div.appendChild(acciones);
  return div;
}

function renderClientList(){
  const wrap = document.getElementById('clientList');
  wrap.innerHTML = '';

  if(clients.length === 0){
    wrap.innerHTML = '<div class="empty" style="padding:16px 0;">Todavía no hay clientes cargados.</div>';
    return;
  }

  const grupos = {};
  DIAS_CANON.concat(['Otros']).forEach(d => grupos[d] = []);
  clients.forEach((c, i)=>{
    diasDeCliente(c).forEach(d => grupos[d].push(i));
  });

  DIAS_CANON.concat(['Otros']).forEach(d=>{
    if(grupos[d].length === 0) return;

    const section = document.createElement('div');
    section.style.cssText = 'border:1px solid #E8C89A; border-radius:8px; margin-top:8px; overflow:hidden;';

    const header = document.createElement('button');
    header.type = 'button';
    header.style.cssText = 'width:100%; text-align:left; background:var(--amber); color:#fff; padding:11px 14px; font-family:var(--disp); font-weight:700; font-size:14px; border:none; display:flex; justify-content:space-between; align-items:center; cursor:pointer;';
    const label = document.createElement('span');
    label.textContent = (d === 'Otros' ? 'Otros / agregados a mano' : d) + ` (${grupos[d].length})`;
    const arrow = document.createElement('span');
    arrow.textContent = '▾';
    arrow.className = 'acc-arrow-list';
    header.appendChild(label);
    header.appendChild(arrow);

    const body = document.createElement('div');
    body.className = 'acc-body-list';
    body.style.cssText = 'display:none; background:#fff; padding:8px;';

    grupos[d].forEach(i=>{
      body.appendChild(crearFilaCliente(clients[i], i));
    });

    header.onclick = ()=>{
      const isOpen = body.style.display === 'block';
      body.style.display = isOpen ? 'none' : 'block';
      arrow.textContent = isOpen ? '▾' : '▴';
    };

    section.appendChild(header);
    section.appendChild(body);
    wrap.appendChild(section);
  });
}

document.getElementById('toggleClientListBtn').onclick = ()=>{
  const listEl = document.getElementById('clientList');
  const btn = document.getElementById('toggleClientListBtn');
  const visible = listEl.style.display !== 'none';
  listEl.style.display = visible ? 'none' : 'block';
  btn.textContent = visible ? 'Ver lista completa de clientes' : 'Ocultar lista de clientes';
};

function abrirMapsEnMiUbicacion(botonEstado){
  if(botonEstado) botonEstado.textContent = 'Ubicando...';
  const restaurar = (texto)=>{ if(botonEstado) botonEstado.textContent = texto; };
  if(!navigator.geolocation){
    window.open('https://www.google.com/maps', '_blank');
    restaurar('📍 Abrir Google Maps');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      const { latitude, longitude } = pos.coords;
      window.open(`https://www.google.com/maps/@${latitude},${longitude},18z`, '_blank');
      restaurar('📍 Abrir Google Maps');
    },
    ()=>{
      // si no consigue el permiso, igual abrimos Maps (sin centrar) para que busque a mano
      window.open('https://www.google.com/maps', '_blank');
      restaurar('📍 Abrir Google Maps');
    },
    { enableHighAccuracy:true, timeout:8000 }
  );
}

document.getElementById('buscarMapsNuevoClienteBtn').onclick = (e)=>{
  abrirMapsEnMiUbicacion(e.currentTarget);
};

document.getElementById('usarMiUbicacionNuevoClienteBtn').onclick = async (e)=>{
  const btn = e.currentTarget;
  const textoOriginal = btn.textContent;
  btn.textContent = 'Ubicando...';
  btn.disabled = true;
  try{
    const pos = await getPosition();
    const link = `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
    document.getElementById('newClientAddrInput').value = link;
    setStatus('Ubicación actual cargada en el campo de dirección.', 'ok');
  }catch(err){
    setStatus('No se pudo obtener la ubicación: ' + describeGeoError(err), 'err');
  }
  btn.textContent = textoOriginal;
  btn.disabled = false;
};

document.getElementById('addClientBtn').onclick = async ()=>{
  const input = document.getElementById('newClientInput');
  const addrInput = document.getElementById('newClientAddrInput');
  const name = input.value.trim();
  const addr = addrInput.value.trim();
  if(!name){
    setStatus('Escribí un nombre antes de tocar Agregar (esto es solo para clientes nuevos, los que ya existen se eligen arriba en el desplegable).', 'err');
    return;
  }
  try{
    await backendPost({ action:'addClient', nombre: name, direccion: addr });
    clients.push({ nombre: name, direccion: addr });
    input.value = '';
    addrInput.value = '';
    renderClientSelect();
    renderClientList();
    setStatus('Cliente agregado: ' + name, 'ok');
  }catch(err){
    setStatus('No se pudo agregar: ' + err.message, 'err');
  }
};

function escapeHtml(s){
  return s.replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// --- Registrar visita ---
async function refrescarUbicacion(){
  const texto = document.getElementById('ubicacionStatusTexto');
  const btn = document.getElementById('refrescarUbicacionBtn');
  texto.textContent = '📍 Buscando tu ubicación...';
  texto.style.color = '#8A9793';
  if(btn) btn.disabled = true;
  try{
    const pos = await getPosition();
    ubicacionActual = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    ubicacionActualHora = new Date();
    texto.textContent = '✓ Ubicación lista (' + formatTime(ubicacionActualHora) + ') — lista para sacar la foto';
    texto.style.color = 'var(--green)';
  }catch(err){
    ubicacionActual = null;
    ubicacionActualHora = null;
    texto.textContent = '⚠ Sin ubicación (' + describeGeoError(err) + '). Tocá Actualizar para reintentar.';
    texto.style.color = '#B4432B';
  }
  if(btn) btn.disabled = false;
}

document.getElementById('refrescarUbicacionBtn').onclick = refrescarUbicacion;

document.getElementById('registerBtn').addEventListener('click', (e)=>{
  if(e.currentTarget.dataset.disabled === 'true'){
    e.preventDefault();
    setStatus('Agregá o elegí un cliente primero.', 'err');
    return;
  }
  if(!backendUrl){
    e.preventDefault();
    setStatus('Conectá el backend arriba antes de registrar un servicio.', 'err');
    return;
  }
  setStatus('Abriendo la cámara...');
});

document.getElementById('photoInput').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const clientObj = (selectedClientIndex != null) ? clients[selectedClientIndex] : null;
  if(!clientObj){
    setStatus('Elegí un cliente primero (tocá un día para desplegarlo).', 'err');
    return;
  }
  const clientLabel = clientObj.direccion ? `${clientObj.nombre} — ${clientObj.direccion}` : clientObj.nombre;
  setStatus('Procesando foto...');

  // Usamos la ubicación que ya se consiguió con el botón "Actualizar" (o al abrir la app).
  // Así no dependemos de que el GPS responda justo en el momento de sacar la foto.
  let lat = null, lon = null;
  let geoErrorReason = null;
  if(ubicacionActual){
    lat = ubicacionActual.lat;
    lon = ubicacionActual.lon;
  } else {
    geoErrorReason = 'no se pudo conseguir antes de sacar la foto — tocá "Actualizar" arriba y esperá a que diga "lista" antes de sacar la próxima';
  }

  try{
    const now = new Date();
    const stampText = [
      clientLabel,
      now.toLocaleDateString('es-AR', {day:'2-digit', month:'2-digit', year:'numeric'}) + '  ' + formatTime(now),
      (lat != null) ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : 'Ubicación no disponible'
    ];
    const dataUrl = await resizeImage(file, 900, 0.7, stampText);

    setStatus('Subiendo foto y guardando el registro...');
    const id = 'r' + now.getTime() + Math.random().toString(36).slice(2,6);
    const resultado = document.getElementById('resultadoSelect').value;
    const resp = await backendPost({
      action: 'addRecord',
      id, cliente: clientObj.nombre, direccion: clientObj.direccion || '',
      fechaISO: now.toISOString(), lat, lon, ubicacionManual: '',
      fotoBase64: dataUrl,
      fechaInicioCliente: clientObj.fechaInicio || '', telefonoCliente: clientObj.telefono || '',
      resultado
    });

    const record = {
      id,
      cliente: clientObj.nombre,
      direccion: clientObj.direccion || '',
      telefono: clientObj.telefono || '',
      fechaISO: now.toISOString(),
      foto: resp.fotoUrl || dataUrl,
      lat, lon,
      ubicacionManual: '',
      resultado,
      observacion: '',
      fotoObservacion: ''
    };
    records.unshift(record);
    renderHistory();
    const ubicOk = lat != null ? ' (con ubicación)' : ` (sin ubicación: ${geoErrorReason || 'motivo desconocido'})`;
    setStatus('Registrado: ' + clientObj.nombre + ' — ' + formatTime(now) + ubicOk, lat != null ? 'ok' : 'err');
  }catch(err){
    setStatus('Error al guardar el registro: ' + err.message, 'err');
  }
  e.target.value = '';
});

function describeGeoError(err){
  if(err && typeof err.code === 'number'){
    if(err.code === 1) return 'permiso denegado, revisá los permisos de ubicación del navegador';
    if(err.code === 2) return 'posición no disponible';
    if(err.code === 3) return 'se agotó el tiempo de espera';
  }
  if(err && err.message) return err.message;
  return 'motivo desconocido';
}

function getPosition(){
  return new Promise((resolve, reject)=>{
    if(!navigator.geolocation){ reject(new Error('el navegador no soporta geolocalización')); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject, {enableHighAccuracy:true, timeout:8000});
  });
}

async function getClimaMomento(lat, lon){
  try{
    const controller = new AbortController();
    const timer = setTimeout(()=> controller.abort(), 6000);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    const cw = data && data.current_weather;
    if(!cw || cw.temperature == null) return null;
    const temp = Math.round(cw.temperature * 10) / 10;
    const viento = Math.round(cw.windspeed);
    return `Clima en el momento: ${temp}°C · viento ${viento} km/h`;
  }catch(err){
    return null; // si falla, seguimos sin esa línea, no rompe el registro
  }
}

function resizeImage(file, maxDim, quality, stampLines){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e)=>{ img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = ()=>{
      let w = img.width, h = img.height;
      if(w > h && w > maxDim){ h = h * maxDim / w; w = maxDim; }
      else if(h > maxDim){ w = w * maxDim / h; h = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      if(stampLines && stampLines.length){
        const pad = Math.max(8, w * 0.02);
        const fontSize = Math.max(12, Math.round(w * 0.032));
        const lineHeight = fontSize * 1.35;
        const barHeight = pad * 2 + stampLines.length * lineHeight;
        ctx.fillStyle = 'rgba(11, 53, 53, 0.72)';
        ctx.fillRect(0, h - barHeight, w, barHeight);
        ctx.font = `600 ${fontSize}px 'IBM Plex Mono', monospace`;
        ctx.fillStyle = '#EFF7F5';
        ctx.textBaseline = 'top';
        stampLines.forEach((line, i)=>{
          ctx.fillText(line, pad, h - barHeight + pad + i * lineHeight);
        });
      }

      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function exportToExcel(){
  if(records.length === 0){
    setStatus('No hay registros para exportar todavía.', 'err');
    return;
  }
  const rows = records.map(rec=>{
    const d = new Date(rec.fechaISO);
    return {
      'Código': rec.id.toUpperCase(),
      'Cliente / Lugar': rec.cliente,
      'Dirección': rec.direccion || '',
      'Fecha': d.toLocaleDateString('es-AR'),
      'Hora': formatTime(d),
      'Latitud': rec.lat != null ? rec.lat : '',
      'Longitud': rec.lon != null ? rec.lon : '',
      'Enlace ubicación': rec.lat != null ? `https://maps.google.com/?q=${rec.lat},${rec.lon}` : (rec.ubicacionManual || ''),
      'Foto': rec.foto || ''
    };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:14},{wch:24},{wch:28},{wch:12},{wch:8},{wch:12},{wch:12},{wch:38},{wch:38}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Servicios');
  const fileName = 'servicios_' + new Date().toISOString().slice(0,10) + '.xlsx';
  XLSX.writeFile(wb, fileName);
}
document.getElementById('exportBtn').onclick = exportToExcel;

document.getElementById('renombrarHistorialBtn').onclick = async ()=>{
  const viejo = document.getElementById('renombrarViejoInput').value.trim();
  const nuevo = document.getElementById('renombrarNuevoInput').value.trim();
  const direccionNueva = document.getElementById('renombrarDireccionInput').value.trim();

  if(!viejo || !nuevo){
    setStatus('Completá el nombre actual y el nombre corregido.', 'err');
    return;
  }
  const ok = confirm(`¿Seguro que querés cambiar "${viejo}" por "${nuevo}" en TODO el historial? Esto actualiza todos los servicios ya registrados con ese nombre. No se puede deshacer solo.`);
  if(!ok) return;

  try{
    const resp = await backendPost({ action:'renombrarEnHistorial', nombreViejo: viejo, nombreNuevo: nuevo, direccionNueva });
    if(resp.error) throw new Error(resp.error);
    setStatus(`Listo: se actualizaron ${resp.actualizados} servicio(s) de "${viejo}" a "${nuevo}".`, 'ok');
    document.getElementById('renombrarViejoInput').value = '';
    document.getElementById('renombrarNuevoInput').value = '';
    document.getElementById('renombrarDireccionInput').value = '';
    await loadAll();
  }catch(err){
    setStatus('No se pudo corregir: ' + err.message, 'err');
  }
};

function formatTime(d){
  return d.toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'});
}
function formatDateTime(iso){
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', {day:'2-digit', month:'2-digit', year:'2-digit'}) + '  ' + formatTime(d);
}

function renderHistory(){
  const wrap = document.getElementById('historyList');
  wrap.innerHTML = '';
  if(records.length === 0){
    wrap.innerHTML = '<div class="empty">Todavía no hay servicios registrados.</div>';
    return;
  }
  records.forEach(rec=>{
    const div = document.createElement('div');
    div.className = 'ticket';
    const direccionLine = rec.direccion ? `<div style="margin-bottom:4px;">${escapeHtml(rec.direccion)}</div>` : '';

    let ubicacionBlock;
    if(rec.lat != null){
      ubicacionBlock = `<a href="https://maps.google.com/?q=${rec.lat},${rec.lon}" target="_blank">Ver ubicación (GPS)</a>`;
    } else if(rec.ubicacionManual){
      ubicacionBlock = `<a href="${escapeHtml(rec.ubicacionManual)}" target="_blank">Ver ubicación (pegada a mano)</a> <button class="btn-manual-loc" data-id="${rec.id}" style="margin-left:6px; font-size:11px; padding:3px 8px; background:none; border:1px solid var(--line); color:var(--teal); border-radius:6px;">Editar</button>`;
    } else {
      ubicacionBlock = `Sin ubicación
        <div style="margin-top:6px; display:flex; flex-direction:column; gap:6px;">
          <button class="btn-usar-mi-ubicacion" data-id="${rec.id}" style="width:100%; box-sizing:border-box; font-size:12px; padding:8px; background:var(--green); color:#fff; border-radius:6px;">📍 Usar mi ubicación actual</button>
          <button class="btn-buscar-maps" style="width:100%; box-sizing:border-box; font-size:12px; padding:8px; background:var(--teal); color:#fff; border-radius:6px;">🗺️ Abrir Maps y compartir ubicación</button>
          <details style="font-size:11px; color:#8A9793;">
            <summary style="cursor:pointer;">¿No podés compartir? Pegar un link a mano</summary>
            <div style="display:flex; gap:6px; margin-top:6px;">
              <input class="manual-loc-input" data-id="${rec.id}" placeholder="Pegá acá el link" style="flex:1; min-width:0; box-sizing:border-box; font-size:12px; padding:6px 8px; border:1px solid var(--line); border-radius:6px;">
              <button class="btn-manual-loc" data-id="${rec.id}" style="flex-shrink:0; font-size:12px; padding:6px 10px; background:var(--teal); color:#fff; border-radius:6px;">Guardar</button>
            </div>
          </details>
        </div>`;
    }

    const coloresResultado = {
      'Se limpió y se desagotó': 'var(--green)',
      'Se limpió pero no se pudo desagotar': 'var(--amber)',
      'Cerrado': '#B4432B',
      'Sin acceso': '#B4432B',
      'Cliente pidió reprogramar': '#8A6D3B'
    };
    const opcionesResultado = ['Se limpió y se desagotó', 'Se limpió pero no se pudo desagotar', 'Cerrado', 'Sin acceso', 'Cliente pidió reprogramar'];
    const resultadoTexto = rec.resultado || 'Se limpió y se desagotó'; // registros viejos sin este dato
    const colorResultado = coloresResultado[resultadoTexto] || '#8A9793';
    const opcionesHtml = opcionesResultado.map(op => `<option value="${escapeHtml(op)}" ${op===resultadoTexto?'selected':''}>${escapeHtml(op)}</option>`).join('');
    const resultadoBadge = `<select class="resultado-select" data-id="${rec.id}" title="Tocá para corregir el resultado" style="display:inline-block; font-size:11.5px; font-weight:700; color:#fff; background:${colorResultado}; padding:4px 22px 4px 9px; border-radius:20px; margin-top:6px; border:none; appearance:none; -webkit-appearance:none; font-family:var(--body); cursor:pointer;">${opcionesHtml}</select>`;

    let observacionBlock;
    if(rec.observacion || rec.fotoObservacion){
      observacionBlock = `
        <div style="margin-top:10px; padding:10px; background:#FBF3E9; border-radius:8px; border:1px solid #EEDCC0;">
          <div style="font-weight:700; font-size:12px; color:#8A6D3B; margin-bottom:4px;">⚠ Observación</div>
          ${rec.observacion ? `<div style="font-size:12.5px; color:#4A5854;">${escapeHtml(rec.observacion)}</div>` : ''}
          ${rec.fotoObservacion ? `<img class="ticket-photo-obs" src="${rec.fotoObservacion}" style="width:100%; border-radius:6px; margin-top:8px; cursor:pointer;">` : ''}
        </div>`;
    } else {
      observacionBlock = `
        <details style="margin-top:10px; font-size:12px; color:#8A9793;">
          <summary style="cursor:pointer; color:var(--teal); font-weight:600;">➕ Agregar observación (algo roto o llamativo)</summary>
          <div style="margin-top:8px; display:flex; flex-direction:column; gap:6px;">
            <textarea class="obs-texto-input" data-id="${rec.id}" placeholder="¿Qué pasó? (ej: el asiento está roto)" style="width:100%; box-sizing:border-box; font-family:var(--body); font-size:12.5px; padding:8px; border:1px solid var(--line); border-radius:6px; resize:vertical; min-height:50px;"></textarea>
            <input type="file" accept="image/*" capture="environment" class="obs-foto-input" data-id="${rec.id}" style="position:absolute; width:1px; height:1px; opacity:0; overflow:hidden;">
            <label class="obs-foto-label" data-id="${rec.id}" style="text-align:center; padding:8px; border:1px dashed var(--line); border-radius:6px; color:var(--teal); font-weight:600; cursor:pointer;">📷 Sacar foto (opcional)</label>
            <span class="obs-foto-nombre" data-id="${rec.id}" style="font-size:11px; color:#8A9793;"></span>
            <button class="btn-guardar-obs" data-id="${rec.id}" style="padding:9px; background:var(--teal); color:#fff; border-radius:6px; font-weight:700;">Guardar observación</button>
          </div>
        </details>`;
    }

    div.innerHTML = `
      <div class="ticket-top">
        <div class="ticket-client">${escapeHtml(rec.cliente)}</div>
        <div class="ticket-code">${rec.id.toUpperCase()}</div>
      </div>
      <div class="ticket-time">${formatDateTime(rec.fechaISO)}</div>
      ${resultadoBadge}
      <div class="ticket-body">
        <img class="ticket-photo" src="${rec.foto}">
        <div class="ticket-info">${direccionLine}${ubicacionBlock}</div>
      </div>
      ${observacionBlock}
      <div class="ticket-actions">
        <button class="btn-wa" data-id="${rec.id}">Enviar por WhatsApp</button>
        <button class="btn-del" data-id="${rec.id}">Eliminar</button>
      </div>
    `;
    wrap.appendChild(div);
  });

  wrap.querySelectorAll('.ticket-photo, .ticket-photo-obs').forEach(img=>{
    img.onclick = ()=>{
      document.getElementById('lightboxImg').src = img.src;
      document.getElementById('lightbox').classList.add('open');
    };
  });
  wrap.querySelectorAll('.btn-wa').forEach(btn=>{
    btn.onclick = ()=> sendWhatsApp(btn.dataset.id);
  });
  wrap.querySelectorAll('.btn-del').forEach(btn=>{
    btn.onclick = async ()=>{
      const rec = records.find(r=>r.id === btn.dataset.id);
      const nombreRec = rec ? rec.cliente : '';
      const ok = confirm('¿Seguro que querés eliminar este registro' + (nombreRec ? ' de "' + nombreRec + '"' : '') + '? No se puede deshacer.');
      if(!ok) return;
      try{
        await backendPost({ action:'deleteRecord', id: btn.dataset.id });
        records = records.filter(r=>r.id !== btn.dataset.id);
        renderHistory();
        setStatus('Registro eliminado.', 'ok');
      }catch(err){ setStatus('No se pudo eliminar: ' + err.message, 'err'); }
    };
  });
  wrap.querySelectorAll('.btn-buscar-maps').forEach(btn=>{
    btn.onclick = (e)=>{
      abrirMapsEnMiUbicacion(e.currentTarget);
      setStatus('En Maps: buscá el lugar, tocá "Compartir" y elegí "Sani3" en la lista de apps.', 'ok');
    };
  });
  wrap.querySelectorAll('.btn-usar-mi-ubicacion').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.dataset.id;
      const rec = records.find(r=>r.id===id);
      if(!rec) return;
      const textoOriginal = btn.textContent;
      btn.textContent = 'Ubicando...';
      btn.disabled = true;
      try{
        const pos = await getPosition();
        const link = `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
        await backendPost({ action:'updateRecordLocation', id, ubicacionManual: link });
        rec.ubicacionManual = link;
        renderHistory();
        setStatus('Ubicación actual guardada para ' + rec.cliente, 'ok');
      }catch(err){
        setStatus('No se pudo obtener la ubicación: ' + describeGeoError(err), 'err');
        btn.textContent = textoOriginal;
        btn.disabled = false;
      }
    };
  });
  wrap.querySelectorAll('.btn-manual-loc').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.dataset.id;
      const rec = records.find(r=>r.id===id);
      if(!rec) return;
      const current = rec.ubicacionManual || '';
      const input = wrap.querySelector(`.manual-loc-input[data-id="${id}"]`);
      const value = input ? input.value.trim() : (prompt('Pegá el link de Google Maps para este servicio:', current) || '').trim();
      if(!value) return;
      try{
        await backendPost({ action:'updateRecordLocation', id, ubicacionManual: value });
        rec.ubicacionManual = value;
        renderHistory();
        setStatus('Ubicación guardada a mano para ' + rec.cliente, 'ok');
      }catch(err){
        setStatus('No se pudo guardar la ubicación: ' + err.message, 'err');
      }
    };
  });

  // --- Observación con foto opcional ---
  wrap.querySelectorAll('.obs-foto-label').forEach(label=>{
    label.onclick = ()=>{
      const id = label.dataset.id;
      wrap.querySelector(`.obs-foto-input[data-id="${id}"]`).click();
    };
  });
  wrap.querySelectorAll('.obs-foto-input').forEach(input=>{
    input.onchange = async ()=>{
      const id = input.dataset.id;
      const file = input.files[0];
      const nombreSpan = wrap.querySelector(`.obs-foto-nombre[data-id="${id}"]`);
      if(!file){ return; }
      nombreSpan.textContent = 'Procesando foto...';
      try{
        const dataUrl = await resizeImage(file, 1280, 0.82, []);
        obsFotosTemp[id] = dataUrl;
        nombreSpan.textContent = '✓ Foto lista para guardar';
        nombreSpan.style.color = 'var(--green)';
      }catch(err){
        nombreSpan.textContent = 'No se pudo procesar la foto';
      }
    };
  });
  wrap.querySelectorAll('.resultado-select').forEach(select=>{
    select.onchange = async ()=>{
      const id = select.dataset.id;
      const rec = records.find(r=>r.id===id);
      if(!rec) return;
      const nuevoResultado = select.value;
      select.disabled = true;
      try{
        const resp = await backendPost({ action:'actualizarResultado', id, resultado: nuevoResultado });
        if(resp.error) throw new Error(resp.error);
        rec.resultado = nuevoResultado;
        renderHistory();
        setStatus('Resultado corregido para ' + rec.cliente, 'ok');
      }catch(err){
        setStatus('No se pudo corregir: ' + err.message, 'err');
        select.disabled = false;
      }
    };
  });
  wrap.querySelectorAll('.btn-guardar-obs').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.dataset.id;
      const rec = records.find(r=>r.id===id);
      if(!rec) return;
      const textarea = wrap.querySelector(`.obs-texto-input[data-id="${id}"]`);
      const observacion = textarea ? textarea.value.trim() : '';
      const fotoObservacionBase64 = obsFotosTemp[id] || '';

      if(!observacion && !fotoObservacionBase64){
        setStatus('Escribí algo o sacá una foto antes de guardar la observación.', 'err');
        return;
      }

      const textoOriginal = btn.textContent;
      btn.textContent = 'Guardando...';
      btn.disabled = true;
      try{
        const resp = await backendPost({ action:'agregarObservacion', id, observacion, fotoObservacionBase64 });
        if(resp.error) throw new Error(resp.error);
        rec.observacion = observacion;
        rec.fotoObservacion = resp.fotoObservacionUrl || rec.fotoObservacion;
        delete obsFotosTemp[id];
        renderHistory();
        setStatus('Observación guardada para ' + rec.cliente, 'ok');
      }catch(err){
        setStatus('No se pudo guardar la observación: ' + err.message, 'err');
        btn.textContent = textoOriginal;
        btn.disabled = false;
      }
    };
  });
}

async function sendWhatsApp(id){
  const rec = records.find(r=>r.id===id);
  if(!rec) return;
  const empresa = config.companyName ? config.companyName + ' — ' : '';
  const ubicacionLink = (rec.lat != null) ? `https://maps.google.com/?q=${rec.lat},${rec.lon}` : (rec.ubicacionManual || '');
  const mapPart = ubicacionLink ? `\nUbicación: ${ubicacionLink}` : '';
  const direccionPart = rec.direccion ? `\nDirección: ${rec.direccion}` : '';
  const text = `${empresa}Servicio realizado\nCliente/lugar: ${rec.cliente}${direccionPart}\nFecha y hora: ${formatDateTime(rec.fechaISO)}${mapPart}`;

  // A propósito NO apuntamos a ningún número de teléfono: el que use la app
  // elige el contacto a mano cada vez, así los empleados no le escriben directo a los clientes.
  try{
    const resp = await fetch(rec.foto);
    const blob = await resp.blob();
    const file = new File([blob], 'servicio.jpg', {type:'image/jpeg'});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], text});
      return;
    }
  }catch(err){ /* seguimos al fallback */ }

  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

// ---------- Arranque ----------
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

todayLabel();
backendUrl = localStorage.getItem(BACKEND_URL_KEY) || '';

// Si llegamos con ?backend=... (por ejemplo, volviendo desde "Compartir ubicación"),
// lo usamos y lo guardamos, así no depende de que el celular comparta la memoria entre pantallas.
const backendDesdeUrl = new URLSearchParams(location.search).get('backend');
if(backendDesdeUrl){
  backendUrl = backendDesdeUrl;
  localStorage.setItem(BACKEND_URL_KEY, backendUrl);
  history.replaceState(null, '', location.pathname); // limpiamos el ?backend=... de la barra de direcciones
}

document.getElementById('backendUrlInput').value = backendUrl;
loadAll();

if(location.protocol === 'file:' || location.protocol === 'content:'){
  showFatalError('Este archivo se abrió desde "' + location.protocol + '" y ese acceso no tiene permiso de ubicación. Abrí la página con su dirección https:// (por ejemplo, la de GitHub Pages) en vez del archivo descargado.');
}

// Buscamos la ubicación apenas carga la página, así ya está lista para la primera foto.
refrescarUbicacion();
