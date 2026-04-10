// ═══════════════════════════════════════════════════════════════
// ESRN 135 - Sistema de Gestión de Fotocopias
// Firebase v8 + Vanilla JS
// ═══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// CONFIGURACIÓN FIREBASE
// NOTA FUTURA: Si cambiás el proyecto de Firebase, actualizá
// todos estos valores desde la consola de Firebase.
// ──────────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey:            "AIzaSyAjATR-ArZxVgcBvCrv5guFZ5-V9aX4avc",
    authDomain:        "gestion-esrn135.firebaseapp.com",
    projectId:         "gestion-esrn135",
    storageBucket:     "gestion-esrn135.firebasestorage.app",
    messagingSenderId: "500789019734",
    appId:             "1:500789019734:web:fee9ac696b04e971dde7f7"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// ──────────────────────────────────────────────────────────────
// CONSTANTE: UMBRAL DEUDOR CRÓNICO
// NOTA FUTURA: Cambiá este número para ajustar el límite.
// ──────────────────────────────────────────────────────────────
const UMBRAL_DEUDOR_CRONICO = 2000;

// Variables globales de estado
let usuarioSeleccionado = null; // Usuario activo en el buscador
let docEditandoId       = null; // ID del documento que se está editando en el modal


// ═══════════════════════════════════════════════════════════════
// 1. AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════════

// Si el usuario ya está logueado al abrir la página, entra directo
auth.onAuthStateChanged((user) => {
    if (user) mostrarApp();
});

document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email    = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorEl  = document.getElementById('login-error');
    errorEl.textContent = "";

    auth.signInWithEmailAndPassword(email, password)
        .catch(() => {
            errorEl.textContent = "Contraseña incorrecta. Intentá de nuevo.";
        });
});

document.getElementById('logout-btn').addEventListener('click', () => {
    auth.signOut();
    document.getElementById('app-container').style.display  = 'none';
    document.getElementById('login-container').style.display = 'flex';
});

function mostrarApp() {
    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display   = 'block';
    iniciarTabs();
    calcularCajaDelDia();
    cargarHistorialGeneral();
    calcularEstadisticas();
    iniciarBuscadorHistorial();
}


// ═══════════════════════════════════════════════════════════════
// 2. NAVEGACIÓN POR TABS
// ═══════════════════════════════════════════════════════════════
function iniciarTabs() {
    const tabs      = document.querySelectorAll('.tab-btn');
    const secciones = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            secciones.forEach(s => s.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });
}


// ═══════════════════════════════════════════════════════════════
// 3. REGISTRO DE MOVIMIENTOS
// ═══════════════════════════════════════════════════════════════

function setAmount(val) {
    document.getElementById('custom-amount').value = val;
}

// ── Autocompletado de nombres ──
document.getElementById('user-name').addEventListener('input', async (e) => {
    const query = e.target.value.trim().toLowerCase();
    const lista = document.getElementById('autocomplete-list');
    lista.innerHTML = "";
    if (query.length < 2) return;

    const snapshot = await db.collection("fotocopias")
        .orderBy("userName")
        .startAt(query)
        .endAt(query + "\uf8ff")
        .limit(6)
        .get();

    const vistos = new Set();
    snapshot.forEach(doc => {
        const nombre = doc.data().userName;
        const curso  = doc.data().userCourse || "";
        if (!vistos.has(nombre)) {
            vistos.add(nombre);
            const li = document.createElement('li');
            li.innerHTML = `${nombre} <span>${curso}</span>`;
            li.addEventListener('click', () => {
                document.getElementById('user-name').value   = nombre;
                document.getElementById('user-course').value = curso;
                lista.innerHTML = "";
            });
            lista.appendChild(li);
        }
    });
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('#user-name') && !e.target.closest('#autocomplete-list')) {
        document.getElementById('autocomplete-list').innerHTML = "";
    }
});

// ── Guardar nuevo movimiento ──
document.getElementById('copy-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = document.getElementById('user-name').value.trim().toLowerCase();
    const monto  = parseFloat(document.getElementById('custom-amount').value);

    if (!nombre)                     { alert("Ingresá el nombre del usuario."); return; }
    if (isNaN(monto) || monto <= 0) { alert("Ingresá un monto válido."); return; }

    const datos = {
        userName:   nombre,
        userCourse: document.getElementById('user-course').value.trim(),
        userRole:   document.getElementById('user-role').value,
        amount:     monto,
        payMethod:  document.getElementById('pay-method').value,
        nota:       document.getElementById('nota-registro').value.trim(),
        fecha:      firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection("fotocopias").add(datos);
        alert("✅ Movimiento registrado.");
        document.getElementById('copy-form').reset();
        calcularCajaDelDia();
    } catch (error) {
        alert("Error al guardar: " + error.message);
    }
});


// ═══════════════════════════════════════════════════════════════
// 4. CAJA DEL DÍA
// ═══════════════════════════════════════════════════════════════
function calcularCajaDelDia() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    db.collection("fotocopias")
        .where("fecha", ">=", hoy)
        .onSnapshot((snapshot) => {
            let efectivo = 0, transferencia = 0, abonos = 0;

            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.payMethod === "Efectivo")      efectivo      += Number(d.amount);
                if (d.payMethod === "Transferencia") transferencia += Number(d.amount);
                if (d.payMethod === "Abono")         abonos        += Number(d.amount);
            });

            const total = efectivo + transferencia + abonos;
            document.getElementById('caja-dia').textContent     = `$${total.toLocaleString('es-AR')}`;
            document.getElementById('caja-detalle').textContent =
                `Efectivo: $${efectivo} · Transf.: $${transferencia} · Abonos: $${abonos}`;
        });
}


// ═══════════════════════════════════════════════════════════════
// 5. BUSCADOR DE USUARIOS
// ═══════════════════════════════════════════════════════════════
document.getElementById('search-input').addEventListener('input', async (e) => {
    const query      = e.target.value.trim().toLowerCase();
    const resultados = document.getElementById('search-results');
    const perfil     = document.getElementById('user-profile');

    resultados.innerHTML = "";
    perfil.style.display = 'none';
    usuarioSeleccionado  = null;

    if (query.length < 2) return;

    const snapshot = await db.collection("fotocopias")
        .orderBy("userName")
        .startAt(query)
        .endAt(query + "\uf8ff")
        .get();

    if (snapshot.empty) {
        resultados.innerHTML = `<p class="empty-msg">No se encontraron usuarios.</p>`;
        return;
    }

    const usuarios = {};
    snapshot.forEach(doc => {
        const d = doc.data();
        if (!usuarios[d.userName]) {
            usuarios[d.userName] = { curso: d.userCourse || "", deuda: 0 };
        }
        if (d.payMethod === "Debe")  usuarios[d.userName].deuda += Number(d.amount);
        if (d.payMethod === "Abono") usuarios[d.userName].deuda -= Number(d.amount);
    });

    Object.entries(usuarios).forEach(([nombre, info]) => {
        const deuda = Math.max(0, info.deuda);
        const div   = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `
            <div>
                <div class="search-result-name">${nombre.toUpperCase()}</div>
                <div class="search-result-info">${info.curso || "Sin curso"}</div>
            </div>
            <div class="search-result-deuda ${deuda > 0 ? 'deuda-roja' : 'deuda-verde'}">
                $${deuda.toLocaleString('es-AR')}
            </div>
        `;
        div.addEventListener('click', () => cargarPerfilUsuario(nombre, info.curso, deuda));
        resultados.appendChild(div);
    });
});

function cargarPerfilUsuario(nombre, curso, saldoDeuda) {
    usuarioSeleccionado = { nombre, curso };

    document.getElementById('user-profile').style.display = 'block';
    document.getElementById('profile-name').textContent   = nombre.toUpperCase();
    document.getElementById('profile-curso').textContent  = curso || "Sin curso";

    const saldoEl  = document.getElementById('profile-saldo');
    const alertaEl = document.getElementById('alerta-deudor');

    saldoEl.textContent    = `$${saldoDeuda.toLocaleString('es-AR')}`;
    saldoEl.className      = 'profile-saldo ' + (saldoDeuda > 0 ? '' : 'verde');
    alertaEl.style.display = saldoDeuda >= UMBRAL_DEUDOR_CRONICO ? 'block' : 'none';

    db.collection("fotocopias")
        .where("userName", "==", nombre)
        .orderBy("fecha", "desc")
        .onSnapshot((snapshot) => {
            const container = document.getElementById('profile-historial');
            container.innerHTML = "";

            if (snapshot.empty) {
                container.innerHTML = `<p class="empty-msg">Sin movimientos registrados.</p>`;
                return;
            }

            let deudaActual = 0;
            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.payMethod === "Debe")  deudaActual += Number(d.amount);
                if (d.payMethod === "Abono") deudaActual -= Number(d.amount);
            });
            deudaActual = Math.max(0, deudaActual);

            saldoEl.textContent    = `$${deudaActual.toLocaleString('es-AR')}`;
            saldoEl.className      = 'profile-saldo ' + (deudaActual > 0 ? '' : 'verde');
            alertaEl.style.display = deudaActual >= UMBRAL_DEUDOR_CRONICO ? 'block' : 'none';

            _perfilDocs = [];
            snapshot.forEach(doc => _perfilDocs.push(doc));
            renderizarMovimientos(_perfilTabActual);
        });
        
    document.getElementById('user-profile').scrollIntoView({ behavior: 'smooth' });
}

let _perfilDocs      = [];
let _perfilTabActual = 'todos';

function mostrarMovTab(tab, btn) {
    _perfilTabActual = tab;
    document.querySelectorAll('.mov-tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderizarMovimientos(tab);
}

function renderizarMovimientos(tab) {
    const container = document.getElementById('profile-historial');
    container.innerHTML = '';
    const filtrados = _perfilDocs.filter(doc => {
        const m = doc.data().payMethod;
        if (tab === 'deudas') return m === 'Debe';
        if (tab === 'abonos') return m === 'Abono';
        return true;
    });
    if (filtrados.length === 0) {
        container.innerHTML = '<p class="empty-msg">Sin movimientos en esta categoría.</p>';
        return;
    }
    filtrados.forEach(doc => {
        const d     = doc.data();
        const id     = doc.id;
        const fecha = d.fecha ? new Date(d.fecha.seconds * 1000).toLocaleDateString('es-AR') : '---';
        const css   = obtenerCSS(d.payMethod);
        const color = d.payMethod === 'Debe' ? 'var(--red)' : 'var(--green)';
        const signo = d.payMethod === 'Abono' ? '-' : '';
        const div   = document.createElement('div');
        div.className = 'mov-item';
        div.innerHTML =
            '<div style="flex:1; min-width:0;">'
            + '<div class="mov-fecha">' + fecha + '</div>'
            + (d.nota ? '<div class="mov-nota">' + d.nota + '</div>' : '')
            + '</div>'
            + '<div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">'
            + '<span class="mov-monto" style="color:' + color + '">'
            + signo + '$' + Number(d.amount).toLocaleString('es-AR')
            + '</span>'
            + '<span class="mov-metodo ' + css + '">' + d.payMethod + '</span>'
            + '<div class="mov-acciones">'
            + '<button class="btn-editar" onclick="abrirEdicion(\'' + id + '\')" title="Editar">&#9999;&#65039;</button>'
            + '<button class="btn-eliminar" onclick="eliminarRegistro(\'' + id + '\')" title="Borrar">&#128465;&#65039;</button>'
            + '</div></div>';
        container.appendChild(div);
    });
}


// ===============================================================
// WHATSAPP - Aviso de deuda
// ===============================================================
function abrirWhatsApp() {
    if (!usuarioSeleccionado) { alert('Seleccioná un usuario primero.'); return; }
    const nombre = usuarioSeleccionado.nombre.toUpperCase();
    const curso  = usuarioSeleccionado.curso || '';
    const saldo  = document.getElementById('profile-saldo').textContent;
    const rol    = _perfilDocs.length > 0 ? (_perfilDocs[0].data().userRole || 'Alumno') : 'Alumno';
    const hoy    = new Date().toLocaleDateString('es-AR');
    let msg;
    if (rol === 'Profesor') {
        msg = 'Hola! Te escribimos desde el Área TIC de la ESRN 135. '
            + 'Quedó pendiente un saldo de *' + saldo + '* en concepto de fotocopias (al ' + hoy + ').\n\n'
            + 'Podés pasar a regularizarlo personalmente o hacer una transferencia al alias *esrn135* '
            + 'y mandarnos el comprobante a este número.\n\n'
            + '¡Gracias! 👋';
    } else {
        msg = 'Hola, le escribimos desde el Área TIC de la ESRN 135. '
            + 'Le informamos que su hijo/a *' + nombre + '*'
            + (curso ? ' (' + curso + ')' : '')
            + ' tiene un saldo pendiente de *' + saldo + '* en concepto de fotocopias (al ' + hoy + ').\n\n'
            + 'Pueden acercarse a regularizarlo personalmente o realizarlo por transferencia al alias *esrn135*. '
            + 'En ese caso, les pedimos que envíen el comprobante de pago a este número.\n\n'
            + '¡Muchas gracias! 😊';
    }
    document.getElementById('wa-mensaje').value  = msg;
    document.getElementById('wa-telefono').value = '';
    document.getElementById('panel-whatsapp').style.display = 'block';
    document.getElementById('panel-whatsapp').scrollIntoView({ behavior: 'smooth' });
}

function cerrarWhatsApp() {
    document.getElementById('panel-whatsapp').style.display = 'none';
}

function enviarWhatsApp() {
    const tel = document.getElementById('wa-telefono').value.trim().replace(/[^0-9]/g, '');
    const msg = document.getElementById('wa-mensaje').value.trim();
    if (!tel || tel.length < 8) { alert('Ingresá un número válido.'); return; }
    if (!msg)                   { alert('El mensaje no puede estar vacío.'); return; }
    window.open('https://wa.me/549' + tel + '?text=' + encodeURIComponent(msg), '_blank');
    cerrarWhatsApp();
}


async function registrarAbono() {
    if (!usuarioSeleccionado) { alert("Seleccioná un usuario primero."); return; }

    const monto  = parseFloat(document.getElementById('abono-monto').value);
    const metodo = document.getElementById('abono-metodo').value;

    if (isNaN(monto) || monto <= 0) { alert("Ingresá un monto válido."); return; }
    if (!confirm(`¿Confirmás un abono de $${monto} para ${usuarioSeleccionado.nombre.toUpperCase()}?`)) return;

    const datos = {
        userName:    usuarioSeleccionado.nombre,
        userCourse:  usuarioSeleccionado.curso || "",
        userRole:    "Alumno",
        amount:      monto,
        payMethod:   "Abono",
        abonoMetodo: metodo,
        nota:        `Abono en ${metodo}`,
        fecha:       firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection("fotocopias").add(datos);
        document.getElementById('abono-monto').value = "";
        alert(`✅ Abono de $${monto} registrado.`);
    } catch (error) {
        alert("Error: " + error.message);
    }
}


// ═══════════════════════════════════════════════════════════════
// 6. EDITAR REGISTRO
// ═══════════════════════════════════════════════════════════════

async function abrirEdicion(docId) {
    docEditandoId = docId;

    try {
        const doc  = await db.collection("fotocopias").doc(docId).get();
        const data = doc.data();

        document.getElementById('edit-nombre').value = data.userName   || '';
        document.getElementById('edit-curso').value  = data.userCourse || '';
        document.getElementById('edit-monto').value  = data.amount     || '';
        document.getElementById('edit-metodo').value = data.payMethod  || 'Debe';
        document.getElementById('edit-nota').value   = data.nota       || '';
        if (data.fecha) {
            const d = new Date(data.fecha.seconds * 1000);
            document.getElementById('edit-fecha').value = d.toISOString().split('T')[0];
        } else {
            document.getElementById('edit-fecha').value = '';
        }

        document.getElementById('modal-editar').style.display = 'flex';
    } catch (error) {
        alert("Error al cargar el registro: " + error.message);
    }
}

async function guardarEdicion() {
    if (!docEditandoId) return;

    const nombre = document.getElementById('edit-nombre').value.trim().toLowerCase();
    const monto  = parseFloat(document.getElementById('edit-monto').value);

    if (!nombre)                     { alert("El nombre no puede estar vacío."); return; }
    if (isNaN(monto) || monto <= 0) { alert("Ingresá un monto válido."); return; }

    const fechaVal = document.getElementById('edit-fecha').value;
    const cambios = {
        userName:   nombre,
        userCourse: document.getElementById('edit-curso').value.trim(),
        amount:     monto,
        payMethod:  document.getElementById('edit-metodo').value,
        nota:       document.getElementById('edit-nota').value.trim()
    };
    if (fechaVal) {
        cambios.fecha = firebase.firestore.Timestamp.fromDate(new Date(fechaVal + 'T12:00:00'));
    }

    try {
        await db.collection("fotocopias").doc(docEditandoId).update(cambios);
        alert("✅ Registro actualizado correctamente.");
        cerrarModal();
    } catch (error) {
        alert("Error al guardar: " + error.message);
    }
}

function cerrarModal() {
    document.getElementById('modal-editar').style.display = 'none';
    docEditandoId = null;
}

document.getElementById('modal-editar').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-editar')) cerrarModal();
});


// ═══════════════════════════════════════════════════════════════
// 7. ELIMINAR REGISTRO
// ═══════════════════════════════════════════════════════════════
function eliminarRegistro(docId) {
    if (!confirm("⚠️ ¿Estás seguro que querés borrar este registro?\nEsta acción no se puede deshacer.")) return;

    db.collection("fotocopias").doc(docId).delete()
        .then(() => alert("🗑️ Registro eliminado."))
        .catch(err => alert("Error: " + err.message));
}

async function saldarDeuda(docId) {
    try {
        const docSnap = await db.collection("fotocopias").doc(docId).get();
        const data    = docSnap.data();
        const nombre  = (data.userName || 'este usuario').toUpperCase();
        const monto   = Number(data.amount).toLocaleString('es-AR');
        if (!confirm('✅ ¿Confirmás que ' + nombre + ' pagó $' + monto + ' en efectivo?\n\nEsta acción marcará el movimiento como pagado.')) return;
        await db.collection("fotocopias").doc(docId).update({ payMethod: "Efectivo" });
        alert("✅ Deuda saldada correctamente.");
    } catch (err) {
        alert("Error: " + err.message);
    }
}


// ═══════════════════════════════════════════════════════════════
// 8. HISTORIAL GENERAL CON FILTROS + BUSCADOR
// ═══════════════════════════════════════════════════════════════

function iniciarBuscadorHistorial() {
    document.getElementById('historial-search').addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        document.querySelectorAll('#cuerpo-tabla tr').forEach(fila => {
            fila.style.display = fila.textContent.toLowerCase().includes(query) ? '' : 'none';
        });
    });
}

let _historialFiltros   = {};
let _historialUltimoDoc = null;
let _historialHayMas    = false;
const HISTORIAL_PAGINA  = 50;

function cargarHistorialGeneral(filtros = {}, paginar = false) {
    if (!paginar) { _historialFiltros = filtros; _historialUltimoDoc = null; }

    let base = db.collection("fotocopias").orderBy("fecha", "desc");
    if (_historialFiltros.metodo) base = db.collection("fotocopias").where("payMethod", "==", _historialFiltros.metodo).orderBy("fecha", "desc");
    if (_historialFiltros.desde)  base = base.where("fecha", ">=", new Date(_historialFiltros.desde));
    if (_historialFiltros.hasta) {
        const fin = new Date(_historialFiltros.hasta);
        fin.setDate(fin.getDate() + 1);
        base = base.where("fecha", "<=", fin);
    }

    let consulta = base.limit(HISTORIAL_PAGINA + 1);
    if (_historialUltimoDoc) consulta = base.startAfter(_historialUltimoDoc).limit(HISTORIAL_PAGINA + 1);

    consulta.get().then((snapshot) => {
        const docs       = snapshot.docs;
        _historialHayMas = docs.length > HISTORIAL_PAGINA;
        const visibles   = _historialHayMas ? docs.slice(0, HISTORIAL_PAGINA) : docs;
        if (visibles.length > 0) _historialUltimoDoc = visibles[visibles.length - 1];

        const tbody = document.getElementById('cuerpo-tabla');
        if (!paginar) tbody.innerHTML = '';

        if (visibles.length === 0 && !paginar) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">Sin registros para mostrar.</td></tr>';
            actualizarBtnMas();
            return;
        }

        visibles.forEach(doc => {
            const d     = doc.data();
            const id     = doc.id;
            const fecha = d.fecha ? new Date(d.fecha.seconds * 1000).toLocaleDateString('es-AR') : '---';
            const css   = obtenerCSS(d.payMethod);
            const tr    = document.createElement('tr');
            const nota  = d.nota || '—';
            const name  = d.userName ? d.userName.toUpperCase() : '---';
            tr.innerHTML =
                '<td>' + fecha + '</td>'
                + '<td style="font-weight:600;">' + name + '</td>'
                + '<td style="font-family:var(--font-mono); font-weight:700;">$' + Number(d.amount).toLocaleString('es-AR') + '</td>'
                + '<td><span class="badge ' + css + '">' + d.payMethod + '</span></td>'
                + '<td class="nota-cell" title="' + (d.nota || '') + '">' + nota + '</td>'
                + '<td><div class="acciones-cell">'
                + (d.payMethod === 'Debe' ? '<button class="btn-pagar" onclick="saldarDeuda(\'' + id + '\')">✅ Pagar</button>' : '')
                + '<button class="btn-editar" onclick="abrirEdicion(\'' + id + '\')">✏️ Editar</button>'
                + '<button class="btn-eliminar" onclick="eliminarRegistro(\'' + id + '\')">🗑️ Borrar</button>'
                + '</div></td>';
            tbody.appendChild(tr);
        });

        const query = document.getElementById('historial-search').value.trim().toLowerCase();
        if (query) {
            document.querySelectorAll('#cuerpo-tabla tr').forEach(fila => {
                fila.style.display = fila.textContent.toLowerCase().includes(query) ? '' : 'none';
            });
        }
        actualizarBtnMas();
    });
}

function actualizarBtnMas() {
    const btn = document.getElementById('btn-cargar-mas');
    if (btn) btn.style.display = _historialHayMas ? 'inline-block' : 'none';
}

function cargarMasHistorial() {
    if (_historialHayMas) cargarHistorialGeneral(_historialFiltros, true);
}

function aplicarFiltros() {
    cargarHistorialGeneral({
        desde:  document.getElementById('filtro-desde').value,
        hasta:  document.getElementById('filtro-hasta').value,
        metodo: document.getElementById('filtro-metodo').value
    });
}


// ═══════════════════════════════════════════════════════════════
// 9. RESUMEN IMPRIMIBLE
// ═══════════════════════════════════════════════════════════════
async function imprimirResumen() {
    if (!usuarioSeleccionado) { alert("Seleccioná un usuario primero."); return; }

    const nombre   = usuarioSeleccionado.nombre;
    const snapshot = await db.collection("fotocopias")
        .where("userName", "==", nombre)
        .orderBy("fecha", "desc")
        .get();

    let deuda = 0;
    let filas = "";

    snapshot.forEach(doc => {
        const d     = doc.data();
        const fecha = d.fecha ? new Date(d.fecha.seconds * 1000).toLocaleDateString('es-AR') : '---';
        if (d.payMethod === "Debe")  deuda += Number(d.amount);
        if (d.payMethod === "Abono") deuda -= Number(d.amount);

        filas += `
            <tr>
                <td>${fecha}</td>
                <td>${d.payMethod}</td>
                <td>$${Number(d.amount).toLocaleString('es-AR')}</td>
                <td>${d.nota || ''}</td>
            </tr>
        `;
    });

    deuda = Math.max(0, deuda);

    document.getElementById('print-area').innerHTML = `
        <div class="print-title">ESRN 135 — Resumen de cuenta</div>
        <div class="print-subtitle">Generado el ${new Date().toLocaleDateString('es-AR')}</div>
        <div class="print-saldo">Alumno: ${nombre.toUpperCase()} | Saldo adeudado: $${deuda.toLocaleString('es-AR')}</div>
        <table class="print-table">
            <thead><tr><th>Fecha</th><th>Método</th><th>Monto</th><th>Nota</th></tr></thead>
            <tbody>${filas}</tbody>
        </table>
        <p style="margin-top:16px; font-size:0.8rem; color:#555;">Alias: esrn135 · WhatsApp: 2920-298994</p>
    `;

    window.print();
}


// ═══════════════════════════════════════════════════════════════
// 10. EXPORTAR CSV
// ═══════════════════════════════════════════════════════════════
async function exportarCSV() {
    try {
        const snapshot = await db.collection("fotocopias").orderBy("fecha", "desc").get();
        let csv = "\ufeffFecha,Nombre,Curso,Monto,Metodo,Nota\n";

        snapshot.forEach(doc => {
            const d     = doc.data();
            const fecha = d.fecha ? new Date(d.fecha.seconds * 1000).toLocaleDateString('es-AR') : '---';
            csv += `${fecha},"${d.userName || ''}","${d.userCourse || ''}",${d.amount || 0},"${d.payMethod || ''}","${d.nota || ''}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href     = URL.createObjectURL(blob);
        link.download = `Fotocopias_ESRN135_${new Date().toLocaleDateString('es-AR').replace(/\//g,'-')}.csv`;
        link.click();
    } catch (error) {
        alert("Error al exportar: " + error.message);
    }
}


// ═══════════════════════════════════════════════════════════════
// 11. ESTADÍSTICAS MENSUALES
// ═══════════════════════════════════════════════════════════════
function calcularEstadisticas() {
    const ahora     = new Date();
    const primerDia = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const nombreMes = ahora.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
    const el = document.getElementById('stats-filtro-curso');
    const filtroCurso = el ? el.value.trim().toLowerCase() : '';

    document.getElementById('stats-periodo').textContent =
        filtroCurso ? 'Período: ' + nombreMes + ' · Curso: ' + filtroCurso : 'Período: ' + nombreMes;

    db.collection("fotocopias").where("fecha", ">=", primerDia).get().then((snapshot) => {
        let recaudadoMes = 0;
        snapshot.forEach(doc => {
            const d = doc.data();
            if (filtroCurso && (d.userCourse || '').toLowerCase() !== filtroCurso) return;
            if (d.payMethod !== "Debe") recaudadoMes += Number(d.amount);
        });
        document.getElementById('stat-mes').textContent = '$' + recaudadoMes.toLocaleString('es-AR');
    });

    db.collection("fotocopias").where("payMethod", "in", ["Debe", "Abono"]).onSnapshot((snapshot) => {
        let total = 0;
        snapshot.forEach(doc => {
            const d = doc.data();
            if (d.payMethod === "Debe")  total += Number(d.amount);
            if (d.payMethod === "Abono") total -= Number(d.amount);
        });
        document.getElementById('stat-deuda').textContent = '$' + Math.max(0, total).toLocaleString('es-AR');
    });

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    db.collection("fotocopias").where("fecha", ">=", hoy).onSnapshot((snapshot) => {
        let recHoy = 0;
        snapshot.forEach(doc => {
            if (doc.data().payMethod !== "Debe") recHoy += Number(doc.data().amount);
        });
        document.getElementById('stat-hoy').textContent = '$' + recHoy.toLocaleString('es-AR');
    });
}


// ═══════════════════════════════════════════════════════════════
// 12. CIERRE DE MES (NUEVO)
// ═══════════════════════════════════════════════════════════════
async function generarCierreMes() {
    const desdeVal = document.getElementById('cierre-desde').value;
    const hastaVal = document.getElementById('cierre-hasta').value;
    
    if (!desdeVal || !hastaVal) { alert('Seleccioná las dos fechas.'); return; }
    
    const desde = new Date(desdeVal + 'T00:00:00');
    const hasta = new Date(hastaVal + 'T23:59:59');

    try {
        const snapshot = await db.collection("fotocopias")
            .where("fecha", ">=", desde)
            .where("fecha", "<=", hasta)
            .get();

        const deudores = {};

        snapshot.forEach(doc => {
            const d = doc.data();
            const nombre = d.userName;
            if (!deudores[nombre]) {
                deudores[nombre] = { 
                    nombre: nombre.toUpperCase(), 
                    curso: d.userCourse || "Sin curso", 
                    saldo: 0 
                };
            }
            if (d.payMethod === "Debe") deudores[nombre].saldo += Number(d.amount);
            if (d.payMethod === "Abono") deudores[nombre].saldo -= Number(d.amount);
        });

        const listaFinal = Object.values(deudores).filter(u => u.saldo > 0);
        const tbody = document.getElementById('cuerpo-cierre');
        tbody.innerHTML = "";

        if (listaFinal.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="empty-msg">No hay deudores en este período.</td></tr>';
            return;
        }

        listaFinal.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-weight:600;">${u.nombre}</td>
                <td>${u.curso}</td>
                <td style="color:var(--red); font-weight:700;">$${u.saldo.toLocaleString('es-AR')}</td>
            `;
            tbody.appendChild(tr);
        });

        alert("✅ Cierre generado con éxito.");
    } catch (error) {
        alert("Error al generar cierre: " + error.message);
    }
}


// ═══════════════════════════════════════════════════════════════
// 13. UTILIDADES
// ═══════════════════════════════════════════════════════════════
function obtenerCSS(metodo) {
    switch (metodo) {
        case "Debe":          return "metodo-debe";
        case "Efectivo":      return "metodo-efectivo";
        case "Transferencia": return "metodo-transfer";
        case "Abono":         return "metodo-abono";
        default:              return "";
    }
}