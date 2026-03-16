// ═══════════════════════════════════════════════════════════════
// ESRN 135 - Sistema de Gestión de Fotocopias
// Autor: Área TIC · Firebase v8 + Vanilla JS
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
// CONSTANTE: UMBRAL DE DEUDOR CRÓNICO
// NOTA FUTURA: Cambiá este número para ajustar el límite
// a partir del cual un usuario se considera deudor crónico.
// ──────────────────────────────────────────────────────────────
const UMBRAL_DEUDOR_CRONICO = 2000;

// Variable global para guardar el nombre del usuario seleccionado
// en el buscador (necesario para registrar el abono).
let usuarioSeleccionado = null;

// ═══════════════════════════════════════════════════════════════
// 1. AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════════

// Observador de estado: si el usuario ya está logueado al cargar
// la página, mostramos la app directamente sin pedir contraseña.
auth.onAuthStateChanged((user) => {
    if (user) {
        mostrarApp();
    }
});

// Login con email y contraseña
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

// Cerrar sesión
document.getElementById('logout-btn').addEventListener('click', () => {
    auth.signOut();
    document.getElementById('app-container').style.display = 'none';
    document.getElementById('login-container').style.display = 'flex';
});

// Muestra la aplicación y arranca todas las funciones
function mostrarApp() {
    document.getElementById('login-container').style.display  = 'none';
    document.getElementById('app-container').style.display    = 'block';
    iniciarTabs();
    calcularCajaDelDia();
    cargarHistorialGeneral();
    calcularEstadisticas();
    notificarDeudoresCronicos();
}

// ═══════════════════════════════════════════════════════════════
// 2. NAVEGACIÓN POR TABS
// ═══════════════════════════════════════════════════════════════
function iniciarTabs() {
    const tabs    = document.querySelectorAll('.tab-btn');
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

// Setea el monto desde los botones de precio rápido
function setAmount(val) {
    document.getElementById('custom-amount').value = val;
}

// ── AUTOCOMPLETADO DE NOMBRES ──
// Lee los nombres registrados en Firestore y sugiere coincidencias
// al escribir en el campo de nombre.
document.getElementById('user-name').addEventListener('input', async (e) => {
    const query = e.target.value.trim().toLowerCase();
    const lista  = document.getElementById('autocomplete-list');
    lista.innerHTML = "";

    if (query.length < 2) return;

    // Busca todos los documentos cuyo userName empiece con lo que se escribe
    const snapshot = await db.collection("fotocopias")
        .orderBy("userName")
        .startAt(query)
        .endAt(query + "\uf8ff")
        .limit(6)
        .get();

    // Construye lista sin duplicados
    const vistos = new Set();
    snapshot.forEach(doc => {
        const nombre = doc.data().userName;
        const curso  = doc.data().userCourse || "";
        if (!vistos.has(nombre)) {
            vistos.add(nombre);
            const li = document.createElement('li');
            li.innerHTML = `${nombre} <span>${curso}</span>`;
            li.addEventListener('click', () => {
                document.getElementById('user-name').value  = nombre;
                document.getElementById('user-course').value = curso;
                lista.innerHTML = "";
            });
            lista.appendChild(li);
        }
    });
});

// Cierra el autocompletado al hacer clic fuera
document.addEventListener('click', (e) => {
    if (!e.target.closest('#user-name') && !e.target.closest('#autocomplete-list')) {
        document.getElementById('autocomplete-list').innerHTML = "";
    }
});

// ── GUARDAR MOVIMIENTO ──
document.getElementById('copy-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const nombre = document.getElementById('user-name').value.trim().toLowerCase();
    const monto  = parseFloat(document.getElementById('custom-amount').value);

    // Validaciones básicas
    if (!nombre) { alert("Ingresá el nombre del usuario."); return; }
    if (isNaN(monto) || monto <= 0) { alert("Ingresá un monto válido."); return; }

    const datos = {
        userName:   nombre,
        userCourse: document.getElementById('user-course').value.trim(),
        userRole:   document.getElementById('user-role').value,
        amount:     monto,
        // NOTA FUTURA: payMethod puede ser: "Debe", "Efectivo", "Transferencia", "Abono"
        payMethod:  document.getElementById('pay-method').value,
        fecha:      firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection("fotocopias").add(datos);
        alert("✅ Movimiento registrado.");
        document.getElementById('copy-form').reset();
        calcularCajaDelDia(); // Actualiza caja al instante
    } catch (error) {
        alert("Error al guardar: " + error.message);
    }
});

// ═══════════════════════════════════════════════════════════════
// 4. CAJA DEL DÍA
// Suma todos los ingresos reales del día (excluye las deudas).
// ═══════════════════════════════════════════════════════════════
function calcularCajaDelDia() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    db.collection("fotocopias")
        .where("fecha", ">=", hoy)
        .onSnapshot((snapshot) => {
            let efectivo      = 0;
            let transferencia = 0;
            let abonos        = 0;

            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.payMethod === "Efectivo")      efectivo      += Number(d.amount);
                if (d.payMethod === "Transferencia") transferencia += Number(d.amount);
                if (d.payMethod === "Abono")         abonos        += Number(d.amount);
            });

            const total = efectivo + transferencia + abonos;
            document.getElementById('caja-dia').textContent  = `$${total.toLocaleString('es-AR')}`;
            document.getElementById('caja-detalle').textContent =
                `Efectivo: $${efectivo} · Transf.: $${transferencia} · Abonos: $${abonos}`;
        });
}

// ═══════════════════════════════════════════════════════════════
// 5. BUSCADOR DE USUARIOS
// Busca usuarios por nombre y muestra su saldo + historial.
// ═══════════════════════════════════════════════════════════════
document.getElementById('search-input').addEventListener('input', async (e) => {
    const query      = e.target.value.trim().toLowerCase();
    const resultados = document.getElementById('search-results');
    const perfil     = document.getElementById('user-profile');

    resultados.innerHTML = "";
    perfil.style.display = 'none';
    usuarioSeleccionado  = null;

    if (query.length < 2) return;

    // Busca coincidencias de nombre en Firestore
    const snapshot = await db.collection("fotocopias")
        .orderBy("userName")
        .startAt(query)
        .endAt(query + "\uf8ff")
        .get();

    if (snapshot.empty) {
        resultados.innerHTML = `<p class="empty-msg">No se encontraron usuarios con ese nombre.</p>`;
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

    // Muestra cada usuario encontrado como tarjeta clickeable
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
        // Al hacer clic en la tarjeta, carga el perfil completo
        div.addEventListener('click', () => cargarPerfilUsuario(nombre, info.curso, deuda));
        resultados.appendChild(div);
    });
});

// ── CARGAR PERFIL DE USUARIO ──
// Muestra el historial completo del usuario y el formulario de abono.
function cargarPerfilUsuario(nombre, curso, saldoDeuda) {
    usuarioSeleccionado = { nombre, curso };

    document.getElementById('user-profile').style.display = 'block';
    document.getElementById('profile-name').textContent   = nombre.toUpperCase();
    document.getElementById('profile-curso').textContent  = curso || "Sin curso";

    const saldoEl    = document.getElementById('profile-saldo');
    const alertaEl   = document.getElementById('alerta-deudor');

    saldoEl.textContent = `$${saldoDeuda.toLocaleString('es-AR')}`;
    saldoEl.className   = 'profile-saldo ' + (saldoDeuda > 0 ? '' : 'verde');

    // Mostrar alerta si supera el umbral de deudor crónico
    alertaEl.style.display = saldoDeuda >= UMBRAL_DEUDOR_CRONICO ? 'block' : 'none';

    // Cargar el historial del usuario en tiempo real
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

            // Recalcula saldo en tiempo real con cada actualización
            let deudaActual = 0;
            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.payMethod === "Debe")  deudaActual += Number(d.amount);
                if (d.payMethod === "Abono") deudaActual -= Number(d.amount);
            });
            deudaActual = Math.max(0, deudaActual);

            saldoEl.textContent = `$${deudaActual.toLocaleString('es-AR')}`;
            saldoEl.className   = 'profile-saldo ' + (deudaActual > 0 ? '' : 'verde');
            alertaEl.style.display = deudaActual >= UMBRAL_DEUDOR_CRONICO ? 'block' : 'none';

            // Renderiza cada movimiento
            snapshot.forEach(doc => {
                const d = doc.data();
                const fecha = d.fecha ? new Date(d.fecha.seconds * 1000).toLocaleDateString('es-AR') : '---';
                const cssBadge = obtenerCSS(d.payMethod);

                const div = document.createElement('div');
                div.className = 'mov-item';
                div.innerHTML = `
                    <div>
                        <div class="mov-fecha">${fecha}</div>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <span class="mov-monto" style="color: ${d.payMethod === 'Debe' ? 'var(--red)' : 'var(--green)'}">
                            ${d.payMethod === 'Abono' ? '-' : ''}$${Number(d.amount).toLocaleString('es-AR')}
                        </span>
                        <span class="mov-metodo badge ${cssBadge}">${d.payMethod}</span>
                    </div>
                `;
                container.appendChild(div);
            });
        });

    // Scroll suave hasta el perfil
    document.getElementById('user-profile').scrollIntoView({ behavior: 'smooth' });
}

// ── REGISTRAR ABONO PARCIAL ──
// Crea un nuevo movimiento de tipo "Abono" con monto negativo para
// descontar de la deuda del usuario seleccionado.
async function registrarAbono() {
    if (!usuarioSeleccionado) {
        alert("Seleccioná un usuario primero.");
        return;
    }

    const monto   = parseFloat(document.getElementById('abono-monto').value);
    const metodo  = document.getElementById('abono-metodo').value;

    if (isNaN(monto) || monto <= 0) {
        alert("Ingresá un monto válido para el abono.");
        return;
    }

    if (!confirm(`¿Confirmás un abono de $${monto} para ${usuarioSeleccionado.nombre.toUpperCase()}?`)) return;

    const datos = {
        userName:   usuarioSeleccionado.nombre,
        userCourse: usuarioSeleccionado.curso || "",
        userRole:   "Alumno",
        amount:     monto,
        // NOTA FUTURA: Los abonos siempre se guardan con payMethod = "Abono"
        // y se descuentan de la deuda en el cálculo de saldo.
        payMethod:  "Abono",
        abonoMetodo: metodo, // Guarda si fue en efectivo o transferencia
        fecha:      firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection("fotocopias").add(datos);
        document.getElementById('abono-monto').value = "";
        alert(`✅ Abono de $${monto} registrado correctamente.`);
    } catch (error) {
        alert("Error al registrar abono: " + error.message);
    }
}

// ═══════════════════════════════════════════════════════════════
// 6. HISTORIAL GENERAL CON FILTROS
// ═══════════════════════════════════════════════════════════════
function cargarHistorialGeneral(filtros = {}) {
    let consulta = db.collection("fotocopias").orderBy("fecha", "desc").limit(50);

    // NOTA FUTURA: Para cambiar el límite de registros mostrados,
    // cambiá el número en .limit(50) de arriba.

    if (filtros.desde) {
        consulta = consulta.where("fecha", ">=", new Date(filtros.desde));
    }
    if (filtros.hasta) {
        // Agrega un día para incluir registros del día "hasta"
        const hastaFin = new Date(filtros.hasta);
        hastaFin.setDate(hastaFin.getDate() + 1);
        consulta = consulta.where("fecha", "<=", hastaFin);
    }
    if (filtros.metodo) {
        consulta = db.collection("fotocopias")
            .where("payMethod", "==", filtros.metodo)
            .orderBy("fecha", "desc")
            .limit(50);
    }

    consulta.onSnapshot((snapshot) => {
        const tbody = document.getElementById('cuerpo-tabla');
        tbody.innerHTML = "";

        if (snapshot.empty) {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-msg">Sin registros para mostrar.</td></tr>`;
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
                <td style="font-family: var(--font-mono);">$${Number(d.amount).toLocaleString('es-AR')}</td>
                <td><span class="badge ${css}">${d.payMethod}</span></td>
                <td>
                    ${esDeuda
                        ? `<button class="btn-pagar" onclick="saldarDeuda('${id}')">✅ Pagar</button>`
                        : '—'
                    }
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
}

// ── APLICAR FILTROS AL HISTORIAL ──
function aplicarFiltros() {
    const filtros = {
        desde:  document.getElementById('filtro-desde').value,
        hasta:  document.getElementById('filtro-hasta').value,
        metodo: document.getElementById('filtro-metodo').value
    };
    cargarHistorialGeneral(filtros);
}

// ── SALDAR DEUDA COMPLETA ──
// Cambia el estado del registro de "Debe" a "Efectivo"
// (pago completo de ese movimiento puntual).
function saldarDeuda(docId) {
    if (!confirm("¿Confirmás que este movimiento fue pagado completamente?")) return;

    db.collection("fotocopias").doc(docId).update({ payMethod: "Efectivo" })
        .then(() => alert("✅ Deuda saldada."))
        .catch(err => alert("Error: " + err.message));
}

// ═══════════════════════════════════════════════════════════════
// 7. EXPORTAR CSV
// Descarga todos los movimientos como archivo Excel-compatible.
// ═══════════════════════════════════════════════════════════════
async function exportarCSV() {
    try {
        const snapshot = await db.collection("fotocopias").orderBy("fecha", "desc").get();

        // BOM UTF-8 para que Excel lea correctamente los acentos
        let csv = "\ufeffFecha,Nombre,Curso,Monto,Metodo\n";

        snapshot.forEach(doc => {
            const d     = doc.data();
            const fecha = d.fecha ? new Date(d.fecha.seconds * 1000).toLocaleDateString('es-AR') : '---';
            // Escapamos comas dentro de los campos por las dudas
            csv += `${fecha},"${d.userName || ''}","${d.userCourse || ''}",${d.amount || 0},"${d.payMethod || ''}"\n`;
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
// 8. ESTADÍSTICAS MENSUALES
// ═══════════════════════════════════════════════════════════════
function calcularEstadisticas() {
    const ahora    = new Date();
    const primerDia = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const nombreMes = ahora.toLocaleString('es-AR', { month: 'long', year: 'numeric' });

    document.getElementById('stats-periodo').textContent = `Período: ${nombreMes}`;

    // Escucha en tiempo real todos los movimientos del mes actual
    db.collection("fotocopias")
        .where("fecha", ">=", primerDia)
        .onSnapshot((snapshot) => {
            let recaudadoMes = 0;
            const saldosPorUsuario = {};

            snapshot.forEach(doc => {
                const d = doc.data();

                // Recaudación del mes (excluyendo deudas)
                if (d.payMethod !== "Debe") {
                    recaudadoMes += Number(d.amount);
                }

                // Saldo acumulado por usuario para detectar deudores crónicos
                if (!saldosPorUsuario[d.userName]) {
                    saldosPorUsuario[d.userName] = { deuda: 0, curso: d.userCourse || "" };
                }
                if (d.payMethod === "Debe")  saldosPorUsuario[d.userName].deuda += Number(d.amount);
                if (d.payMethod === "Abono") saldosPorUsuario[d.userName].deuda -= Number(d.amount);
            });

            document.getElementById('stat-mes').textContent = `$${recaudadoMes.toLocaleString('es-AR')}`;

            // Deudores crónicos (saldo mayor al umbral definido arriba)
            const cronicos = Object.entries(saldosPorUsuario)
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

    // Deuda total acumulada (histórico completo, no solo el mes)
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

    // Recaudación del día de hoy (se reutiliza caja-dia del tab 1)
    // Conectamos el valor al stat también
    db.collection("fotocopias")
        .where("fecha", ">=", (() => { const h = new Date(); h.setHours(0,0,0,0); return h; })())
        .onSnapshot((snapshot) => {
            let hoy = 0;
            snapshot.forEach(doc => {
                if (doc.data().payMethod !== "Debe") hoy += Number(doc.data().amount);
            });
            document.getElementById('stat-hoy').textContent = `$${hoy.toLocaleString('es-AR')}`;
        });
}

// ═══════════════════════════════════════════════════════════════
// 9. NOTIFICACIÓN DE DEUDORES CRÓNICOS AL CARGAR
// Al iniciar la app, muestra un aviso si hay deudores con saldo
// mayor al umbral definido.
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

    const cronicos = Object.entries(saldos)
        .filter(([, deuda]) => deuda >= UMBRAL_DEUDOR_CRONICO);

    if (cronicos.length > 0) {
        const nombres = cronicos.map(([n]) => n.toUpperCase()).join(", ");
        console.warn(`⚠️ Deudores crónicos detectados: ${nombres}`);
        // NOTA FUTURA: Podés reemplazar el console.warn por un toast visual
        // o modal si querés que la notificación sea más visible.
        setTimeout(() => {
            alert(`⚠️ Hay ${cronicos.length} deudor(es) crónico(s):\n\n${nombres}\n\nRevisá la pestaña Estadísticas.`);
        }, 1000);
    }
}

// ═══════════════════════════════════════════════════════════════
// 10. UTILIDADES
// ═══════════════════════════════════════════════════════════════

// Devuelve la clase CSS según el método de pago para los badges
// NOTA FUTURA: Si agregás un nuevo método de pago, añadí su caso acá.
function obtenerCSS(metodo) {
    switch (metodo) {
        case "Debe":          return "metodo-debe";
        case "Efectivo":      return "metodo-efectivo";
        case "Transferencia": return "metodo-transfer";
        case "Abono":         return "metodo-abono";
        default:              return "";
    }
}