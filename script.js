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
let docEditandoId       = null; // ID del documento que se está editando


// ═══════════════════════════════════════════════════════════════
// 1. TEMA CLARO / OSCURO
// ═══════════════════════════════════════════════════════════════

// Aplica el tema guardado al cargar la página (antes del login)
(function aplicarTemaGuardado() {
    const temaGuardado = localStorage.getItem('tema') || 'dark';
    document.documentElement.setAttribute('data-theme', temaGuardado);
    actualizarIconoTema(temaGuardado);
})();

// Alterna entre claro y oscuro, y guarda la preferencia
// NOTA FUTURA: El tema se guarda en localStorage del navegador.
// Si querés que siempre arranque en un tema fijo, cambiá 'dark' arriba.
function toggleTheme() {
    const html         = document.documentElement;
    const temaActual   = html.getAttribute('data-theme');
    const nuevoTema    = temaActual === 'dark' ? 'light' : 'dark';

    html.setAttribute('data-theme', nuevoTema);
    localStorage.setItem('tema', nuevoTema);
    actualizarIconoTema(nuevoTema);
}

function actualizarIconoTema(tema) {
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = tema === 'dark' ? '☀️' : '🌙';
}


// ═══════════════════════════════════════════════════════════════
// 2. AUTENTICACIÓN
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
    notificarDeudoresCronicos();
    iniciarBuscadorHistorial();
}


// ═══════════════════════════════════════════════════════════════
// 3. NAVEGACIÓN POR TABS
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
// 4. REGISTRO DE MOVIMIENTOS
// ═══════════════════════════════════════════════════════════════

function setAmount(val) {
    document.getElementById('custom-amount').value = val;
}

// ── Autocompletado de nombres al escribir ──
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

    if (!nombre)               { alert("Ingresá el nombre del usuario."); return; }
    if (isNaN(monto) || monto <= 0) { alert("Ingresá un monto válido."); return; }

    const datos = {
        userName:   nombre,
        userCourse: document.getElementById('user-course').value.trim(),
        userRole:   document.getElementById('user-role').value,
        amount:     monto,
        // NOTA FUTURA: payMethod puede ser: "Debe", "Efectivo", "Transferencia", "Abono"
        payMethod:  document.getElementById('pay-method').value,
        // NOTA FUTURA: El campo "nota" es opcional; queda vacío si no se completa
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
// 5. CAJA DEL DÍA
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
            document.getElementById('caja-dia').textContent    = `$${total.toLocaleString('es-AR')}`;
            document.getElementById('caja-detalle').textContent =
                `Efectivo: $${efectivo} · Transf.: $${transferencia} · Abonos: $${abonos}`;
        });
}


// ═══════════════════════════════════════════════════════════════
// 6. BUSCADOR DE USUARIOS
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

    // Agrupa por nombre y calcula saldo neto
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

// ── Cargar perfil completo de un usuario ──
function cargarPerfilUsuario(nombre, curso, saldoDeuda) {
    usuarioSeleccionado = { nombre, curso };

    document.getElementById('user-profile').style.display = 'block';
    document.getElementById('profile-name').textContent   = nombre.toUpperCase();
    document.getElementById('profile-curso').textContent  = curso || "Sin curso";

    const saldoEl  = document.getElementById('profile-saldo');
    const alertaEl = document.getElementById('alerta-deudor');

    saldoEl.textContent = `$${saldoDeuda.toLocaleString('es-AR')}`;
    saldoEl.className   = 'profile-saldo ' + (saldoDeuda > 0 ? '' : 'verde');
    alertaEl.style.display = saldoDeuda >= UMBRAL_DEUDOR_CRONICO ? 'block' : 'none';

    // Escucha en tiempo real los movimientos del usuario
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

            // Recalcula saldo en tiempo real
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

            snapshot.forEach(doc => {
                const d      = doc.data();
                const fecha  = d.fecha ? new Date(d.fecha.seconds * 1000).toLocaleDateString('es-AR') : '---';
                const css    = obtenerCSS(d.payMethod);
                const esAbono = d.payMethod === 'Abono';

                const div = document.createElement('div');
                div.className = 'mov-item';
                div.innerHTML = `
                    <div>
                        <div class="mov-fecha">${fecha}</div>
                        ${d.nota ? `<div style="font-size:0.72rem; color:var(--text-dim); font-style:italic;">${d.nota}</div>` : ''}
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <span class="mov-monto" style="color: ${d.payMethod === 'Debe' ? 'var(--red)' : 'var(--green)'}">
                            ${esAbono ? '-' : ''}$${Number(d.amount).toLocaleString('es-AR')}
                        </span>
                        <span class="mov-metodo badge ${css}">${d.payMethod}</span>
                    </div>
                `;
                container.appendChild(div);
            });
        });

    document.getElementById('user-profile').scrollIntoView({ behavior: 'smooth' });
}

// ── Registrar abono parcial ──
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
        // NOTA FUTURA: Los abonos reducen la deuda automáticamente en el cálculo de saldo
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
// 7. RESUMEN IMPRIMIBLE / WHATSAPP
// Genera una vista limpia del historial del usuario seleccionado
// lista para imprimir o copiar y mandar por WhatsApp.
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

    // Llena el área de impresión
    document.getElementById('print-area').innerHTML = `
        <div class="print-title">ESRN 135 — Resumen de cuenta</div>
        <div class="print-subtitle">Generado el ${new Date().toLocaleDateString('es-AR')}</div>
        <div class="print-saldo">Alumno: ${nombre.toUpperCase()} | Saldo adeudado: $${deuda.toLocaleString('es-AR')}</div>
        <table class="print-table">
            <thead>
                <tr><th>Fecha</th><th>Método</th><th>Monto</th><th>Nota</th></tr>
            </thead>
            <tbody>${filas}</tbody>
        </table>
        <p style="margin-top:16px; font-size:0.8rem; color:#555;">
            Alias: esrn135 · WhatsApp: 2920-298994
        </p>
    `;

    window.print();
}


// ═══════════════════════════════════════════════════════════════
// 8. HISTORIAL GENERAL CON FILTROS + BUSCADOR
// ═══════════════════════════════════════════════════════════════

// Buscador en tiempo real dentro del historial
function iniciarBuscadorHistorial() {
    document.getElementById('historial-search').addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        // Filtra las filas visibles en la tabla sin nueva consulta a Firestore
        const filas = document.querySelectorAll('#cuerpo-tabla tr');
        filas.forEach(fila => {
            const texto = fila.textContent.toLowerCase();
            fila.style.display = texto.includes(query) ? '' : 'none';
        });
    });
}

function cargarHistorialGeneral(filtros = {}) {
    let consulta = db.collection("fotocopias").orderBy("fecha", "desc").limit(80);
    // NOTA FUTURA: Para mostrar más registros, cambiá el número en .limit(80)

    if (filtros.metodo) {
        consulta = db.collection("fotocopias")
            .where("payMethod", "==", filtros.metodo)
            .orderBy("fecha", "desc")
            .limit(80);
    }

    if (filtros.desde) {
        consulta = consulta.where("fecha", ">=", new Date(filtros.desde));
    }
    if (filtros.hasta) {
        const hastaFin = new Date(filtros.hasta);
        hastaFin.setDate(hastaFin.getDate() + 1);
        consulta = consulta.where("fecha", "<=", hastaFin);
    }

    consulta.onSnapshot((snapshot) => {
        const tbody = document.getElementById('cuerpo-tabla');
        tbody.innerHTML = "";

        if (snapshot.empty) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-msg">Sin registros para mostrar.</td></tr>`;
            return;
        }

        snapshot.forEach(doc => {
            const d     = doc.data();
            const id    = doc.id;
            const fecha = d.fecha ? new Date(d.fecha.seconds * 1000).toLocaleDateString('es-AR') : '---';
            const css   = obtenerCSS(d.payMethod);
            const esDeuda = d.payMethod === 'Debe';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${fecha}</td>
                <td>${d.userName ? d.userName.toUpperCase() : '---'}</td>
                <td style="font-family:var(--font-mono);">$${Number(d.amount).toLocaleString('es-AR')}</td>
                <td><span class="badge ${css}">${d.payMethod}</span></td>
                <td class="nota-cell" title="${d.nota || ''}">${d.nota || '—'}</td>
                <td>
                    <div class="acciones-cell">
                        ${esDeuda ? `<button class="btn-pagar" onclick="saldarDeuda('${id}')">✅ Pagar</button>` : ''}
                        <button class="btn-editar"   onclick="abrirEdicion('${id}')">✏️ Editar</button>
                        <button class="btn-eliminar" onclick="eliminarRegistro('${id}')">🗑️ Borrar</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Reaplica el buscador si hay algo escrito
        const query = document.getElementById('historial-search').value.trim().toLowerCase();
        if (query) {
            document.querySelectorAll('#cuerpo-tabla tr').forEach(fila => {
                fila.style.display = fila.textContent.toLowerCase().includes(query) ? '' : 'none';
            });
        }
    });
}

function aplicarFiltros() {
    const filtros = {
        desde:  document.getElementById('filtro-desde').value,
        hasta:  document.getElementById('filtro-hasta').value,
        metodo: document.getElementById('filtro-metodo').value
    };
    cargarHistorialGeneral(filtros);
}

// ── Saldar deuda completa (cambia a Efectivo) ──
function saldarDeuda(docId) {
    if (!confirm("¿Confirmás que este movimiento fue pagado completamente?")) return;
    db.collection("fotocopias").doc(docId).update({ payMethod: "Efectivo" })
        .then(() => alert("✅ Deuda saldada."))
        .catch(err => alert("Error: " + err.message));
}

// ── Eliminar registro ──
// NOTA FUTURA: El borrado es permanente. No hay papelera de reciclaje.
function eliminarRegistro(docId) {
    if (!confirm("⚠️ ¿Estás seguro que querés borrar este registro?\nEsta acción no se puede deshacer.")) return;
    db.collection("fotocopias").doc(docId).delete()
        .then(() => alert("🗑️ Registro eliminado."))
        .catch(err => alert("Error: " + err.message));
}


// ═══════════════════════════════════════════════════════════════
// 9. EDITAR REGISTRO
// ═══════════════════════════════════════════════════════════════

// Abre el modal y carga los datos actuales del registro
async function abrirEdicion(docId) {
    docEditandoId = docId;

    try {
        const doc  = await db.collection("fotocopias").doc(docId).get();
        const data = doc.data();

        document.getElementById('edit-nombre').value  = data.userName   || '';
        document.getElementById('edit-curso').value   = data.userCourse || '';
        document.getElementById('edit-monto').value   = data.amount     || '';
        document.getElementById('edit-metodo').value  = data.payMethod  || 'Debe';
        document.getElementById('edit-nota').value    = data.nota       || '';

        document.getElementById('modal-editar').style.display = 'flex';
    } catch (error) {
        alert("Error al cargar el registro: " + error.message);
    }
}

// Guarda los cambios del modal al documento en Firestore
async function guardarEdicion() {
    if (!docEditandoId) return;

    const nombre = document.getElementById('edit-nombre').value.trim().toLowerCase();
    const monto  = parseFloat(document.getElementById('edit-monto').value);

    if (!nombre)               { alert("El nombre no puede estar vacío."); return; }
    if (isNaN(monto) || monto <= 0) { alert("Ingresá un monto válido."); return; }

    const cambios = {
        userName:   nombre,
        userCourse: document.getElementById('edit-curso').value.trim(),
        amount:     monto,
        payMethod:  document.getElementById('edit-metodo').value,
        nota:       document.getElementById('edit-nota').value.trim()
    };

    try {
        await db.collection("fotocopias").doc(docEditandoId).update(cambios);
        alert("✅ Registro actualizado.");
        cerrarModal();
    } catch (error) {
        alert("Error al guardar: " + error.message);
    }
}

function cerrarModal() {
    document.getElementById('modal-editar').style.display = 'none';
    docEditandoId = null;
}

// Cierra el modal al hacer clic en el fondo oscuro
document.getElementById('modal-editar').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-editar')) cerrarModal();
});


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

    document.getElementById('stats-periodo').textContent = `Período: ${nombreMes}`;

    db.collection("fotocopias")
        .where("fecha", ">=", primerDia)
        .onSnapshot((snapshot) => {
            let recaudadoMes = 0;
            const saldos     = {};

            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.payMethod !== "Debe") recaudadoMes += Number(d.amount);

                if (!saldos[d.userName]) saldos[d.userName] = { deuda: 0, curso: d.userCourse || "" };
                if (d.payMethod === "Debe")  saldos[d.userName].deuda += Number(d.amount);
                if (d.payMethod === "Abono") saldos[d.userName].deuda -= Number(d.amount);
            });

            document.getElementById('stat-mes').textContent = `$${recaudadoMes.toLocaleString('es-AR')}`;

            const cronicos = Object.entries(saldos)
                .filter(([, info]) => info.deuda >= UMBRAL_DEUDOR_CRONICO)
                .sort((a, b) => b[1].deuda - a[1].deuda);

            document.getElementById('stat-cronicos').textContent = cronicos.length;

            const listaEl = document.getElementById('lista-deudores');
            listaEl.innerHTML = "";

            if (cronicos.length === 0) {
                listaEl.innerHTML = `<p class="empty-msg">Sin deudores crónicos este mes. 🎉</p>`;
            } else {
                cronicos.forEach(([nombre, info]) => {
                    const div = document.createElement('div');
                    div.className = 'deudor-item';
                    div.innerHTML = `
                        <div>
                            <div class="deudor-nombre">${nombre.toUpperCase()}</div>
                            <div class="deudor-info">${info.curso || 'Sin curso'}</div>
                        </div>
                        <div class="deudor-monto">$${Math.max(0, info.deuda).toLocaleString('es-AR')}</div>
                    `;
                    listaEl.appendChild(div);
                });
            }
        });

    // Deuda total histórica
    db.collection("fotocopias")
        .where("payMethod", "in", ["Debe", "Abono"])
        .onSnapshot((snapshot) => {
            let totalDeuda = 0;
            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.payMethod === "Debe")  totalDeuda += Number(d.amount);
                if (d.payMethod === "Abono") totalDeuda -= Number(d.amount);
            });
            document.getElementById('stat-deuda').textContent =
                `$${Math.max(0, totalDeuda).toLocaleString('es-AR')}`;
        });

    // Recaudación de hoy
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    db.collection("fotocopias")
        .where("fecha", ">=", hoy)
        .onSnapshot((snapshot) => {
            let recHoy = 0;
            snapshot.forEach(doc => {
                if (doc.data().payMethod !== "Debe") recHoy += Number(doc.data().amount);
            });
            document.getElementById('stat-hoy').textContent = `$${recHoy.toLocaleString('es-AR')}`;
        });
}


// ═══════════════════════════════════════════════════════════════
// 12. NOTIFICACIÓN DE DEUDORES CRÓNICOS AL INICIAR
// ═══════════════════════════════════════════════════════════════
async function notificarDeudoresCronicos() {
    const snapshot = await db.collection("fotocopias")
        .where("payMethod", "in", ["Debe", "Abono"])
        .get();

    const saldos = {};
    snapshot.forEach(doc => {
        const d = doc.data();
        if (!saldos[d.userName]) saldos[d.userName] = 0;
        if (d.payMethod === "Debe")  saldos[d.userName] += Number(d.amount);
        if (d.payMethod === "Abono") saldos[d.userName] -= Number(d.amount);
    });

    const cronicos = Object.entries(saldos).filter(([, deuda]) => deuda >= UMBRAL_DEUDOR_CRONICO);

    if (cronicos.length > 0) {
        const nombres = cronicos.map(([n]) => n.toUpperCase()).join(", ");
        // NOTA FUTURA: Para desactivar este aviso al iniciar, comentá las líneas de setTimeout abajo
        setTimeout(() => {
            alert(`⚠️ Hay ${cronicos.length} deudor(es) crónico(s):\n\n${nombres}\n\nRevisá la pestaña Estadísticas.`);
        }, 1000);
    }
}


// ═══════════════════════════════════════════════════════════════
// 13. UTILIDADES
// ═══════════════════════════════════════════════════════════════

// Devuelve la clase CSS para el badge según método de pago
// NOTA FUTURA: Si agregás un nuevo método, añadí su caso acá
function obtenerCSS(metodo) {
    switch (metodo) {
        case "Debe":          return "metodo-debe";
        case "Efectivo":      return "metodo-efectivo";
        case "Transferencia": return "metodo-transfer";
        case "Abono":         return "metodo-abono";
        default:              return "";
    }
}