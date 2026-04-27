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
let usuarioSeleccionado = null;
let docEditandoId       = null;
let equipoEditandoId    = null;


// ═══════════════════════════════════════════════════════════════
// 1. AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════════

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
        .catch((error) => {
            errorEl.textContent = "Error al ingresar: " + error.message;
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
    cargarEquipos();
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
        const phone  = doc.data().userPhone  || "";
        if (!vistos.has(nombre)) {
            vistos.add(nombre);
            const li = document.createElement('li');
            li.innerHTML = `${nombre} <span>${curso}</span>`;
            li.addEventListener('click', () => {
                document.getElementById('user-name').value   = nombre;
                document.getElementById('user-course').value = curso;
                if (phone) document.getElementById('user-phone').value = phone;
                lista.innerHTML = "";
            });
            lista.appendChild(li);
        }
    });

    // Auto-fill saldo a favor if user has credit
    const nombreActual = document.getElementById('user-name').value.trim().toLowerCase();
    if (nombreActual.length >= 2) {
        const snapSaldo = await db.collection("fotocopias")
            .where("userName", "==", nombreActual).get();
        let balance = 0;
        snapSaldo.forEach(d => {
            const data = d.data();
            if (data.payMethod === "Debe")      balance += Number(data.amount);
            if (data.payMethod === "Abono")     balance -= Number(data.amount);
            if (data.payMethod === "A Favor")   balance -= Number(data.amount);
            if (data.payMethod === "Descuento") balance += Number(data.amount);
        });
        const saldoFavor = Math.max(0, -balance);
        const badge = document.getElementById('badge-saldo-favor-registro');
        if (badge) {
            badge.style.display = saldoFavor > 0 ? 'inline-block' : 'none';
            badge.textContent   = `💚 Tiene $${saldoFavor.toLocaleString('es-AR')} a favor`;
        }
    }
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
    const payMethod = document.getElementById('pay-method').value;

    if (!nombre)                     { alert("Ingresá el nombre del usuario."); return; }
    if (isNaN(monto) || monto <= 0) { alert("Ingresá un monto válido."); return; }

    try {
        // SOLO si es "Debe" (fotocopia sin pagar), aplicar descuento automático de saldo a favor
        if (payMethod === "Debe") {
            // Obtener todos los movimientos del usuario
            const snapUsuario = await db.collection("fotocopias")
                .where("userName", "==", nombre)
                .get();
            
            // Calcular balance actual
            let balanceTotal = 0;
            snapUsuario.forEach(doc => {
                const d = doc.data();
                if (d.payMethod === "Debe")      balanceTotal += Number(d.amount);
                if (d.payMethod === "Abono")     balanceTotal -= Number(d.amount);
                if (d.payMethod === "A Favor")   balanceTotal -= Number(d.amount);
                if (d.payMethod === "Descuento") balanceTotal += Number(d.amount);
            });
            
            // Saldo a favor es cuando el balance es negativo
            const saldoAFavor = Math.max(0, -balanceTotal);
            
            console.log(`DEBUG: Usuario ${nombre}, balance actual: ${balanceTotal}, saldo a favor: ${saldoAFavor}, monto: ${monto}`);
            
            // Si hay saldo a favor, descontarlo del monto a registrar
            if (saldoAFavor > 0) {
                const montoDescontado = Math.min(saldoAFavor, monto);
                const montoDeuda = monto - montoDescontado;
                
                console.log(`DEBUG: Descontando ${montoDescontado} del saldo a favor, nueva deuda: ${montoDeuda}`);
                
                // Registrar el descuento del saldo a favor
                if (montoDescontado > 0) {
                    await db.collection("fotocopias").add({
                        userName:   nombre,
                        userCourse: document.getElementById('user-course').value.trim(),
                        userRole:   document.getElementById('user-role').value,
                        userPhone:  document.getElementById('user-phone').value.trim().replace(/[^0-9]/g, ''),
                        amount:     montoDescontado,
                        payMethod:  "Descuento",
                        nota:       "Descuento automático de saldo a favor",
                        fecha:      firebase.firestore.FieldValue.serverTimestamp()
                    });
                    console.log(`DEBUG: Registrado DESCUENTO por ${montoDescontado}`);
                }
                
                // Registrar la deuda pendiente (si hay)
                if (montoDeuda > 0) {
                    await db.collection("fotocopias").add({
                        userName:   nombre,
                        userCourse: document.getElementById('user-course').value.trim(),
                        userRole:   document.getElementById('user-role').value,
                        userPhone:  document.getElementById('user-phone').value.trim().replace(/[^0-9]/g, ''),
                        amount:     montoDeuda,
                        payMethod:  "Debe",
                        nota:       document.getElementById('nota-registro').value.trim(),
                        fecha:      firebase.firestore.FieldValue.serverTimestamp()
                    });
                    console.log(`DEBUG: Registrado DEBE por ${montoDeuda}`);
                }
                
                alert(`✅ Movimiento registrado.\n\n📊 Desglose:\n💚 Saldo a favor descontado: $${montoDescontado.toLocaleString('es-AR')}\n📝 Nueva deuda: $${montoDeuda.toLocaleString('es-AR')}`);
            } else {
                // Sin saldo a favor, registrar normalmente como deuda
                await db.collection("fotocopias").add({
                    userName:   nombre,
                    userCourse: document.getElementById('user-course').value.trim(),
                    userRole:   document.getElementById('user-role').value,
                    userPhone:  document.getElementById('user-phone').value.trim().replace(/[^0-9]/g, ''),
                    amount:     monto,
                    payMethod:  "Debe",
                    nota:       document.getElementById('nota-registro').value.trim(),
                    fecha:      firebase.firestore.FieldValue.serverTimestamp()
                });
                console.log(`DEBUG: Sin saldo a favor, registrado DEBE por ${monto}`);
                alert("✅ Movimiento registrado.");
            }
        } else {
            // Para otros métodos (Efectivo, Transferencia, Abono, A Favor), registrar directamente
            const datos = {
                userName:   nombre,
                userCourse: document.getElementById('user-course').value.trim(),
                userRole:   document.getElementById('user-role').value,
                userPhone:  document.getElementById('user-phone').value.trim().replace(/[^0-9]/g, ''),
                amount:     monto,
                payMethod:  payMethod,
                nota:       document.getElementById('nota-registro').value.trim(),
                fecha:      firebase.firestore.FieldValue.serverTimestamp()
            };
            
            await db.collection("fotocopias").add(datos);
            console.log(`DEBUG: Registrado ${payMethod} por ${monto}`);
            alert("✅ Movimiento registrado.");
        }
        
        document.getElementById('copy-form').reset();
        calcularCajaDelDia();
    } catch (error) {
        console.error("ERROR:", error);
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
            usuarios[d.userName] = { curso: d.userCourse || "", balance: 0 };
        }
        if (d.payMethod === "Debe")      usuarios[d.userName].balance += Number(d.amount);
        if (d.payMethod === "Abono")     usuarios[d.userName].balance -= Number(d.amount);
        if (d.payMethod === "A Favor")   usuarios[d.userName].balance -= Number(d.amount);
        if (d.payMethod === "Descuento") usuarios[d.userName].balance += Number(d.amount);
    });

    Object.entries(usuarios).forEach(([nombre, info]) => {
        const balance = info.balance;
        const deuda   = Math.max(0, balance);
        const favor   = Math.max(0, -balance);
        const div     = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `
            <div>
                <div class="search-result-name">${nombre.toUpperCase()}</div>
                <div class="search-result-info">${info.curso || "Sin curso"}</div>
            </div>
            <div class="search-result-deuda ${favor > 0 ? 'deuda-favor' : (deuda > 0 ? 'deuda-roja' : 'deuda-verde')}">
                ${favor > 0 ? '💚 +$' + favor.toLocaleString('es-AR') + ' a favor' : '$' + deuda.toLocaleString('es-AR')}
            </div>
        `;
        div.addEventListener('click', () => cargarPerfilUsuario(nombre, info.curso, balance));
        resultados.appendChild(div);
    });
});

function cargarPerfilUsuario(nombre, curso, balanceInicial) {
    usuarioSeleccionado = { nombre, curso };

    document.getElementById('user-profile').style.display = 'block';
    document.getElementById('profile-name').textContent   = nombre.toUpperCase();
    document.getElementById('profile-curso').textContent  = curso || "Sin curso";

    const saldoEl     = document.getElementById('profile-saldo');
    const saldoLabel  = document.getElementById('profile-saldo-label');
    const alertaEl    = document.getElementById('alerta-deudor');
    const alertaFavor = document.getElementById('alerta-favor');

    function actualizarSaldoUI(balance) {
        const deuda = Math.max(0, balance);
        const favor = Math.max(0, -balance);
        if (favor > 0) {
            saldoEl.textContent    = `+$${favor.toLocaleString('es-AR')}`;
            saldoEl.className      = 'profile-saldo verde';
            saldoLabel.textContent = 'Saldo a favor';
            alertaEl.style.display    = 'none';
            alertaFavor.style.display = 'block';
            alertaFavor.textContent   = `💚 Este usuario tiene $${favor.toLocaleString('es-AR')} a favor. Se descontará de la próxima deuda.`;
        } else {
            saldoEl.textContent    = `$${deuda.toLocaleString('es-AR')}`;
            saldoEl.className      = 'profile-saldo ' + (deuda > 0 ? '' : 'verde');
            saldoLabel.textContent = 'Saldo deudor';
            alertaEl.style.display    = deuda >= UMBRAL_DEUDOR_CRONICO ? 'block' : 'none';
            alertaFavor.style.display = 'none';
        }
    }

    actualizarSaldoUI(balanceInicial);

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

            let balanceActual = 0;
            snapshot.forEach(doc => {
                const d = doc.data();
                if (d.payMethod === "Debe")      balanceActual += Number(d.amount);
                if (d.payMethod === "Abono")     balanceActual -= Number(d.amount);
                if (d.payMethod === "A Favor")   balanceActual -= Number(d.amount);
                if (d.payMethod === "Descuento") balanceActual += Number(d.amount);
            });

            actualizarSaldoUI(balanceActual);

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
        if (tab === 'abonos') return m === 'Abono' || m === 'Descuento';
        if (tab === 'favor')  return m === 'A Favor';
        return true;
    });
    if (filtrados.length === 0) {
        container.innerHTML = '<p class="empty-msg">Sin movimientos en esta categoría.</p>';
        return;
    }
    filtrados.forEach(doc => {
        const d     = doc.data();
        const id    = doc.id;
        const fecha = d.fecha ? new Date(d.fecha.seconds * 1000).toLocaleDateString('es-AR') : '---';
        const css   = obtenerCSS(d.payMethod);
        const color = d.payMethod === 'Debe' ? 'var(--red)' : 'var(--green)';
        const signo = (d.payMethod === 'Abono' || d.payMethod === 'A Favor' || d.payMethod === 'Descuento') ? '+' : '';
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
            + '<button class="btn-editar" onclick="abrirEdicion(\'' + id + '\')" title="Editar">✏️</button>'
            + '<button class="btn-eliminar" onclick="eliminarRegistro(\'' + id + '\')" title="Borrar">🗑️</button>'
            + '</div></div>';
        container.appendChild(div);
    });
}


// ═══════════════════════════════════════════════════════════════
// WHATSAPP — Aviso individual (panel del perfil de usuario)
// ═══════════════════════════════════════════════════════════════
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


// ═══════════════════════════════════════════════════════════════
// WHATSAPP — avisarDeudor(nombre, saldo)
// Abre el chat de la ESCUELA con el mensaje del deudor cargado.
// El receptor es siempre el número de la escuela (no el del padre).
// ──────────────────────────────────────────────────────────────
// NOTA FUTURA: Si cambia el número de la escuela, modificá solo
// la variable 'numeroBase' en la primera línea de la función.
// ═══════════════════════════════════════════════════════════════
function avisarDeudor(nombre, saldo) {
    // 1. Limpiar y normalizar el número de la escuela
    let numeroBase = "2920298994";
    numeroBase = numeroBase.replace(/[\s\-]/g, "");               // quitar espacios y guiones
    if (numeroBase.startsWith("0")) numeroBase = numeroBase.slice(1); // quitar 0 inicial si existe
    if (!numeroBase.startsWith("549")) numeroBase = "549" + numeroBase; // agregar prefijo Argentina
    // Resultado esperado: "5492920298994"

    // 2. Formatear el saldo como moneda local argentina
    const saldoFormateado = "$" + Number(saldo).toLocaleString("es-AR");

    // 3. Obtener template del textarea; si no existe, usar mensaje por defecto
    const templateEl = document.getElementById("whatsapp-template");
    const template = (templateEl && templateEl.value.trim())
        ? templateEl.value.trim()
        : "Hola! Te avisamos que *{nombre}* tiene un saldo pendiente de *{saldo}* en concepto de fotocopias.\n\nPodés regularizarlo por transferencia al alias *esrn135* o acercarte personalmente.\n\n¡Gracias! 👋";

    // 4. Reemplazar variables en el template
    const mensaje = template
        .replace(/{nombre}/g, nombre)
        .replace(/{saldo}/g, saldoFormateado);

    // 5. Construir URL y abrir WhatsApp con el chat de la escuela
    const url = "https://wa.me/" + numeroBase + "?text=" + encodeURIComponent(mensaje);
    window.open(url, "_blank");
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


async function registrarSaldoFavor() {
    if (!usuarioSeleccionado) { alert("Seleccioná un usuario primero."); return; }

    const monto  = parseFloat(document.getElementById('favor-monto').value);
    const nota   = document.getElementById('favor-nota').value.trim();

    if (isNaN(monto) || monto <= 0) { alert("Ingresá un monto válido."); return; }
    if (!confirm(`¿Confirmás $${monto} a favor para ${usuarioSeleccionado.nombre.toUpperCase()}?\n\nEste saldo se descontará automáticamente de sus próximas deudas.`)) return;

    const datos = {
        userName:   usuarioSeleccionado.nombre,
        userCourse: usuarioSeleccionado.curso || "",
        userRole:   "Alumno",
        amount:     monto,
        payMethod:  "A Favor",
        nota:       nota || `Saldo a favor`,
        fecha:      firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection("fotocopias").add(datos);
        document.getElementById('favor-monto').value = "";
        document.getElementById('favor-nota').value  = "";
        alert(`✅ $${monto} cargados como saldo a favor para ${usuarioSeleccionado.nombre.toUpperCase()}.`);
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
            const id    = doc.id;
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
        if (d.payMethod === "Debe")    deuda += Number(d.amount);
        if (d.payMethod === "Abono")   deuda -= Number(d.amount);
        if (d.payMethod === "A Favor") deuda -= Number(d.amount);

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

    db.collection("fotocopias").where("payMethod", "in", ["Debe", "Abono", "A Favor"]).onSnapshot((snapshot) => {
        let total = 0;
        snapshot.forEach(doc => {
            const d = doc.data();
            if (d.payMethod === "Debe")    total += Number(d.amount);
            if (d.payMethod === "Abono")   total -= Number(d.amount);
            if (d.payMethod === "A Favor") total -= Number(d.amount);
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


//cambio desde aca ═══════════════════════════════════════════════════════════════
// 12. CIERRE DE MES + TANDA 3: AVISO WHATSAPP MASIVO
// ═══════════════════════════════════════════════════════════════
// 12. CIERRE DE MES + AVISO WHATSAPP
// ═══════════════════════════════════════════════════════════════

const TEMPLATE_CIERRE_DEFAULT =
    'Hola! Le escribimos desde el Área TIC de la ESRN 135.\n\n'
  + 'Le informamos que *{nombre}* tiene un saldo pendiente de *{saldo}* '
  + 'en concepto de fotocopias correspondiente al cierre del período.\n\n'
  + 'Pueden acercarse a regularizarlo o transferir al alias *esrn135* '
  + 'y enviarnos el comprobante.\n\n¡Muchas gracias! 😊';

const TEMPLATE_CIERRE_PROFESOR =
    'Hola! Le escribimos desde el Área TIC de la ESRN 135.\n\n'
  + 'Le informamos que registra un saldo pendiente de *{saldo}* '
  + 'en concepto de fotocopias correspondiente al cierre del período.\n\n'
  + 'Puede regularizarlo acercándose personalmente o transfiriendo al alias *esrn135*.\n\n'
  + '¡Muchas gracias! 😊';

let _cierreDeudoresData = [];

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

        const mapa = {};
        let recaudado = 0;
        const metodos = { Efectivo: 0, Transferencia: 0, Abono: 0, Debe: 0 };

        snapshot.forEach(doc => {
            const d      = doc.data();
            const nombre = d.userName || 'sin nombre';
            if (!mapa[nombre]) {
                mapa[nombre] = {
                    nombre:  nombre.toUpperCase(),
                    curso:   d.userCourse || 'Sin curso',
                    role:    d.userRole   || 'Alumno',
                    phone:   d.userPhone  || '',
                    saldo:   0
                };
            }
            // El rol y teléfono más reciente gana
            if (d.userRole)  mapa[nombre].role  = d.userRole;
            if (d.userPhone) mapa[nombre].phone = d.userPhone;

            if (d.payMethod === "Debe")    mapa[nombre].saldo += Number(d.amount);
            if (d.payMethod === "Abono")   mapa[nombre].saldo -= Number(d.amount);
            if (d.payMethod === "A Favor") mapa[nombre].saldo -= Number(d.amount);

            if (d.payMethod !== "Debe") recaudado += Number(d.amount);
            if (metodos[d.payMethod] !== undefined) metodos[d.payMethod] += Number(d.amount);
        });

        const deudaTotal = Object.values(mapa).reduce((acc, u) => acc + Math.max(0, u.saldo), 0);

        const fD = desde.toLocaleDateString('es-AR');
        const fH = hasta.toLocaleDateString('es-AR');
        document.getElementById('cierre-titulo-periodo').textContent = `Período: ${fD} → ${fH}`;

        document.getElementById('cierre-recaudado').textContent   = '$' + recaudado.toLocaleString('es-AR');
        document.getElementById('cierre-deuda-total').textContent = '$' + deudaTotal.toLocaleString('es-AR');

        document.getElementById('cierre-metodos').innerHTML = `
            <div class="cierre-metodos-grid">
                <div class="metodo-resumen-item">
                    <span class="metodo-resumen-label">💵 Efectivo</span>
                    <span class="metodo-resumen-valor">$${metodos.Efectivo.toLocaleString('es-AR')}</span>
                </div>
                <div class="metodo-resumen-item">
                    <span class="metodo-resumen-label">📱 Transferencia</span>
                    <span class="metodo-resumen-valor">$${metodos.Transferencia.toLocaleString('es-AR')}</span>
                </div>
                <div class="metodo-resumen-item">
                    <span class="metodo-resumen-label">✅ Abonos</span>
                    <span class="metodo-resumen-valor">$${metodos.Abono.toLocaleString('es-AR')}</span>
                </div>
            </div>
        `;

        document.getElementById('cierre-wa-template').value = TEMPLATE_CIERRE_DEFAULT;

        // Solo deudores, separados por rol, ordenados de mayor a menor deuda
        const soloDeudores = Object.values(mapa).filter(u => u.saldo > 0);
        _cierreDeudoresData = [
            ...soloDeudores.filter(u => u.role.toLowerCase() === 'profesor').sort((a, b) => b.saldo - a.saldo),
            ...soloDeudores.filter(u => u.role.toLowerCase() !== 'profesor').sort((a, b) => b.saldo - a.saldo)
        ];
        renderizarCierreDeudores(_cierreDeudoresData);

        document.getElementById('cierre-resultado').style.display = 'block';
        document.getElementById('cierre-resultado').scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        alert("Error al generar cierre: " + error.message);
    }
}

function renderizarCierreDeudores(lista) {
    const contenedor = document.getElementById('cierre-lista-deudores');
    contenedor.innerHTML = '';

    if (lista.length === 0) {
        contenedor.innerHTML = '<p class="empty-msg">No hay deudores en este período. 🎉</p>';
        return;
    }

    const profesores = lista.filter(u => (u.role || '').toLowerCase() === 'profesor');
    const alumnos    = lista.filter(u => (u.role || '').toLowerCase() !== 'profesor');

    function crearItem(u) {
        const esProfesor = (u.role || '').toLowerCase() === 'profesor';
        const div = document.createElement('div');
        div.className = 'deudor-item';
        div.innerHTML = `
            <div>
                <div class="deudor-nombre">${u.nombre}</div>
                <div class="deudor-info">${u.curso}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <span class="deudor-monto">$${u.saldo.toLocaleString('es-AR')}</span>
                <button class="btn-wa" onclick="enviarAviso('${u.nombre}', ${u.saldo}, '${u.role || 'Alumno'}')">
                    📲 Avisar
                </button>
            </div>
        `;
        return div;
    }

    if (profesores.length > 0) {
        const header = document.createElement('div');
        header.className = 'deudores-group-header';
        header.innerHTML = '👨‍🏫 Profesores';
        contenedor.appendChild(header);
        profesores.forEach(u => contenedor.appendChild(crearItem(u)));
    }

    if (alumnos.length > 0) {
        const header = document.createElement('div');
        header.className = 'deudores-group-header';
        header.innerHTML = '🎒 Alumnos';
        contenedor.appendChild(header);
        alumnos.forEach(u => contenedor.appendChild(crearItem(u)));
    }
}

function filtrarCierreDeudores() {
    const query = document.getElementById('cierre-buscador').value.trim().toLowerCase();
    const filtrados = query
        ? _cierreDeudoresData.filter(u =>
            u.nombre.toLowerCase().includes(query) ||
            u.curso.toLowerCase().includes(query))
        : _cierreDeudoresData;
    renderizarCierreDeudores(filtrados);
}

// ── enviarAviso: abre WhatsApp directo sin número fijo ──
// Usa wa.me/?text= (el usuario elige con qué contacto compartirlo).
// Diferencia el mensaje según si es Alumno o Profesor.
function enviarAviso(nombre, saldo, role) {
    const esProfesor = (role || '').toLowerCase() === 'profesor';

    const templateEl  = document.getElementById('cierre-wa-template');
    const templateBase = esProfesor ? TEMPLATE_CIERRE_PROFESOR : TEMPLATE_CIERRE_DEFAULT;
    const template = (templateEl && templateEl.value.trim())
        ? templateEl.value.trim()
        : templateBase;

    const saldoStr = '$' + Number(saldo).toLocaleString('es-AR');
    const msg = template
        .replace(/{nombre}/g, nombre)
        .replace(/{saldo}/g,  saldoStr);

    // wa.me/?text= abre el selector de chat de WhatsApp (sin número hardcodeado)
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

function exportarCierreCSV() {
    if (_cierreDeudoresData.length === 0) { alert('Generá el cierre primero.'); return; }

    let csv = "\ufeffNombre,Curso,Saldo Adeudado\n";
    _cierreDeudoresData.forEach(u => {
        csv += `"${u.nombre}","${u.curso}",${u.saldo}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href     = URL.createObjectURL(blob);
    link.download = `Cierre_ESRN135_${new Date().toLocaleDateString('es-AR').replace(/\//g,'-')}.csv`;
    link.click();
}

function imprimirCierre() {
    if (_cierreDeudoresData.length === 0) { alert('Generá el cierre primero.'); return; }

    const periodo    = document.getElementById('cierre-titulo-periodo').textContent;
    const recaudado  = document.getElementById('cierre-recaudado').textContent;
    const deudaTotal = document.getElementById('cierre-deuda-total').textContent;

    let filas = _cierreDeudoresData.map(u =>
        `<tr><td>${u.nombre}</td><td>${u.curso}</td><td>$${u.saldo.toLocaleString('es-AR')}</td></tr>`
    ).join('');

    document.getElementById('print-area').innerHTML = `
        <div class="print-title">ESRN 135 — Cierre de Período</div>
        <div class="print-subtitle">${periodo} · Generado el ${new Date().toLocaleDateString('es-AR')}</div>
        <div class="print-saldo">Recaudado: ${recaudado} · Total adeudado: ${deudaTotal}</div>
        <table class="print-table">
            <thead><tr><th>Nombre</th><th>Curso</th><th>Saldo</th></tr></thead>
            <tbody>${filas}</tbody>
        </table>
        <p style="margin-top:16px; font-size:0.8rem; color:#555;">Alias: esrn135 · WhatsApp: 2920-298994</p>
    `;
    window.print();
}


// ═══════════════════════════════════════════════════════════════
// 13. EQUIPOS TECNOLÓGICOS
// ═══════════════════════════════════════════════════════════════

let _equiposFiltroActual = 'todos';

async function registrarEquipo() {
    const tipo    = document.getElementById('eq-tipo').value;
    const numero  = document.getElementById('eq-numero').value.trim();
    const docente = document.getElementById('eq-docente').value.trim();
    const curso   = document.getElementById('eq-curso').value.trim();
    const retiro  = document.getElementById('eq-fecha-retiro').value;
    const devol   = document.getElementById('eq-fecha-devolucion').value;
    const nota    = document.getElementById('eq-nota').value.trim();

    if (!docente) { alert('Ingresá el nombre del docente.'); return; }

    const datos = {
        tipo,
        numero:          numero || '—',
        docente:         docente.toLowerCase(),
        curso:           curso || '—',
        fechaRetiro:     retiro ? firebase.firestore.Timestamp.fromDate(new Date(retiro + 'T12:00:00')) : firebase.firestore.FieldValue.serverTimestamp(),
        fechaDevolucion: devol  ? firebase.firestore.Timestamp.fromDate(new Date(devol  + 'T12:00:00')) : null,
        estado:          'En uso',
        nota:            nota || '',
        registrado:      firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection("equipos").add(datos);
        alert('✅ Préstamo registrado.');
        ['eq-numero','eq-docente','eq-curso','eq-fecha-retiro','eq-fecha-devolucion','eq-nota']
            .forEach(id => document.getElementById(id).value = '');
        document.getElementById('eq-tipo').value = 'Netbook';
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function cargarEquipos() {
    db.collection("equipos").orderBy("registrado", "desc").onSnapshot((snapshot) => {
        const tbody = document.getElementById('cuerpo-equipos');
        tbody.innerHTML = '';

        if (snapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">Sin préstamos registrados.</td></tr>';
            return;
        }

        snapshot.forEach(doc => {
            const d  = doc.data();
            const id = doc.id;

            if (_equiposFiltroActual !== 'todos') {
                if (_equiposFiltroActual === 'En uso'   && d.estado !== 'En uso')   return;
                if (_equiposFiltroActual === 'Devuelto' && d.estado !== 'Devuelto') return;
                if (['Netbook','Smart TV','Proyector','Parlante'].includes(_equiposFiltroActual) && d.tipo !== _equiposFiltroActual) return;
            }

            const fechaRetiro = d.fechaRetiro ? new Date(d.fechaRetiro.seconds * 1000).toLocaleDateString('es-AR') : '—';
            const estadoCss   = d.estado === 'En uso' ? 'badge-en-uso' : 'badge-devuelto';
            const iconoTipo   = { Netbook: '💻', 'Smart TV': '📺', Proyector: '📽️', Parlante: '🔊' }[d.tipo] || '📦';

            const tr = document.createElement('tr');
            tr.innerHTML =
                '<td><strong>' + iconoTipo + ' ' + d.tipo + '</strong><br><small style="color:var(--text-muted);">' + d.numero + '</small></td>'
                + '<td style="font-weight:600;">' + (d.docente || '').toUpperCase() + '</td>'
                + '<td>' + d.curso + '</td>'
                + '<td style="font-family:var(--font-mono); font-size:0.8rem;">' + fechaRetiro + '</td>'
                + '<td><span class="badge ' + estadoCss + '">' + d.estado + '</span></td>'
                + '<td><div class="acciones-cell">'
                + (d.estado === 'En uso' ? '<button class="btn-devolver" onclick="marcarDevuelto(\'' + id + '\')">✅ Devuelto</button>' : '')
                + '<button class="btn-editar" onclick="abrirEdicionEquipo(\'' + id + '\')">✏️</button>'
                + '<button class="btn-eliminar" onclick="eliminarEquipo(\'' + id + '\')">🗑️</button>'
                + '</div></td>';
            tbody.appendChild(tr);
        });
    });
}

function filtrarEquipos(filtro, btn) {
    _equiposFiltroActual = filtro;
    document.querySelectorAll('.eq-filtro-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    cargarEquipos();
}

async function marcarDevuelto(docId) {
    if (!confirm('✅ ¿Confirmás la devolución del equipo?')) return;
    try {
        await db.collection("equipos").doc(docId).update({ estado: 'Devuelto' });
        alert('✅ Equipo marcado como devuelto.');
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function eliminarEquipo(docId) {
    if (!confirm('⚠️ ¿Borrar este registro de préstamo? No se puede deshacer.')) return;
    db.collection("equipos").doc(docId).delete()
        .then(() => alert('🗑️ Registro eliminado.'))
        .catch(err => alert('Error: ' + err.message));
}

async function abrirEdicionEquipo(docId) {
    equipoEditandoId = docId;
    try {
        const snap = await db.collection("equipos").doc(docId).get();
        const d    = snap.data();
        document.getElementById('eq-edit-tipo').value    = d.tipo    || 'Netbook';
        document.getElementById('eq-edit-numero').value  = d.numero  || '';
        document.getElementById('eq-edit-docente').value = d.docente || '';
        document.getElementById('eq-edit-curso').value   = d.curso   || '';
        document.getElementById('eq-edit-estado').value  = d.estado  || 'En uso';
        document.getElementById('eq-edit-nota').value    = d.nota    || '';
        document.getElementById('eq-edit-fecha-retiro').value =
            d.fechaRetiro ? new Date(d.fechaRetiro.seconds * 1000).toISOString().split('T')[0] : '';
        document.getElementById('eq-edit-fecha-devolucion').value =
            d.fechaDevolucion ? new Date(d.fechaDevolucion.seconds * 1000).toISOString().split('T')[0] : '';
        document.getElementById('modal-editar-equipo').style.display = 'flex';
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function guardarEdicionEquipo() {
    if (!equipoEditandoId) return;
    const retiroVal = document.getElementById('eq-edit-fecha-retiro').value;
    const devolVal  = document.getElementById('eq-edit-fecha-devolucion').value;

    const cambios = {
        tipo:    document.getElementById('eq-edit-tipo').value,
        numero:  document.getElementById('eq-edit-numero').value.trim() || '—',
        docente: document.getElementById('eq-edit-docente').value.trim().toLowerCase(),
        curso:   document.getElementById('eq-edit-curso').value.trim() || '—',
        estado:  document.getElementById('eq-edit-estado').value,
        nota:    document.getElementById('eq-edit-nota').value.trim()
    };
    if (retiroVal) cambios.fechaRetiro     = firebase.firestore.Timestamp.fromDate(new Date(retiroVal + 'T12:00:00'));
    if (devolVal)  cambios.fechaDevolucion = firebase.firestore.Timestamp.fromDate(new Date(devolVal  + 'T12:00:00'));

    try {
        await db.collection("equipos").doc(equipoEditandoId).update(cambios);
        alert('✅ Préstamo actualizado.');
        cerrarModalEquipo();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

function cerrarModalEquipo() {
    document.getElementById('modal-editar-equipo').style.display = 'none';
    equipoEditandoId = null;
}

document.getElementById('modal-editar-equipo').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-editar-equipo')) cerrarModalEquipo();
});

async function exportarEquiposCSV() {
    try {
        const snapshot = await db.collection("equipos").orderBy("registrado", "desc").get();
        let csv = "\ufeffTipo,Número,Docente,Curso,Fecha Retiro,Fecha Devolución,Estado,Nota\n";
        snapshot.forEach(doc => {
            const d  = doc.data();
            const fR = d.fechaRetiro     ? new Date(d.fechaRetiro.seconds * 1000).toLocaleDateString('es-AR')     : '—';
            const fD = d.fechaDevolucion ? new Date(d.fechaDevolucion.seconds * 1000).toLocaleDateString('es-AR') : '—';
            csv += `"${d.tipo}","${d.numero}","${d.docente}","${d.curso}","${fR}","${fD}","${d.estado}","${d.nota || ''}"\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href     = URL.createObjectURL(blob);
        link.download = `Equipos_ESRN135_${new Date().toLocaleDateString('es-AR').replace(/\//g,'-')}.csv`;
        link.click();
    } catch (err) {
        alert('Error al exportar: ' + err.message);
    }
}


// ═══════════════════════════════════════════════════════════════
// 14. UTILIDADES
// ═══════════════════════════════════════════════════════════════
function obtenerCSS(metodo) {
    switch (metodo) {
        case "Debe":          return "metodo-debe";
        case "Efectivo":      return "metodo-efectivo";
        case "Transferencia": return "metodo-transfer";
        case "Abono":         return "metodo-abono";
        case "A Favor":       return "metodo-favor";
        case "Descuento":     return "metodo-abono";
        default:              return "";
    }
}