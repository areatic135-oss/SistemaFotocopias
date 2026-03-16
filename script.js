// Configuración de Firebase - ESRN 135
const firebaseConfig = {
  apiKey: "AIzaSyAjATR-ArZxVgcBvCrv5guFZ5-V9aX4avc",
  authDomain: "gestion-esrn135.firebaseapp.com",
  projectId: "gestion-esrn135",
  storageBucket: "gestion-esrn135.firebasestorage.app",
  messagingSenderId: "500789019734",
  appId: "1:500789019734:web:fee9ac696b04e971dde7f7",
  measurementId: "G-WRSV3MV613"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// --- LÓGICA DE LA APP ---

// Login
document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const pass = document.getElementById('password').value;

    auth.signInWithEmailAndPassword(email, pass)
        .then(() => {
            document.getElementById('login-container').style.display = 'none';
            document.getElementById('app-container').style.display = 'block';
        })
        .catch(err => alert("Error: Acceso denegado"));
});

// Registro de copias y deudas
document.getElementById('copy-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const datos = {
        nombre: document.getElementById('user-name').value.toLowerCase().trim(),
        curso: document.getElementById('user-course').value,
        monto: parseFloat(document.getElementById('custom-amount').value),
        metodo: document.getElementById('pay-method').value,
        fecha: new Date().toLocaleDateString('es-AR'),
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        await db.collection("movimientos").add(datos);
        alert("✅ Registrado con éxito");
        document.getElementById('copy-form').reset();
    } catch (error) {
        alert("Error al guardar: " + error.message);
    }
});

// Buscador de deuda acumulada
document.getElementById('search-input').addEventListener('input', async (e) => {
    const query = e.target.value.toLowerCase().trim();
    const statusBox = document.getElementById('user-status');
    
    if (query.length < 3) { statusBox.innerHTML = ""; return; }

    const snapshot = await db.collection("movimientos").where("nombre", "==", query).get();
    let deudaTotal = 0;

    snapshot.forEach(doc => {
        if (doc.data().metodo === "Debe") deudaTotal += doc.data().monto;
        if (doc.data().metodo === "Pagado" && doc.data().monto < 0) deudaTotal += doc.data().monto; 
    });

    statusBox.innerHTML = snapshot.empty ? "No hay registros" : 
        `<strong>${query.toUpperCase()}</strong> - Deuda: <span style="color:red">$${deudaTotal}</span>`;
});

function setAmount(val) { document.getElementById('custom-amount').value = val; }

// Función para cargar historial general o filtrado por nombre
function actualizarHistorial(nombreFiltro = "") {
    const cuerpoTabla = document.getElementById('cuerpo-tabla');
    let consulta = db.collection("fotocopias").orderBy("fecha", "desc").limit(15);

    // Si estás buscando a alguien, filtramos la tabla
    if (nombreFiltro.trim() !== "") {
        consulta = db.collection("fotocopias")
            .where("userName", "==", nombreFiltro.trim())
            .orderBy("fecha", "desc");
    }

    consulta.onSnapshot((querySnapshot) => {
        cuerpoTabla.innerHTML = "";
        querySnapshot.forEach((doc) => {
            const dato = doc.data();
            const fecha = dato.fecha ? new Date(dato.fecha.seconds * 1000).toLocaleDateString('es-AR') : '---';
            const colorEstado = dato.payMethod === 'Debe' ? 'color: #e74c3c; font-weight: bold;' : 'color: #27ae60;';

            cuerpoTabla.innerHTML += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px;">${fecha}</td>
                    <td style="padding: 8px;">${dato.userName}</td>
                    <td style="padding: 8px;">$${dato.amount}</td>
                    <td style="padding: 8px; ${colorEstado}">${dato.payMethod}</td>
                </tr>
            `;
        });
    });
}

// Escuchar cuando escribís en el campo de nombre para filtrar la tabla
document.getElementById('user-name').addEventListener('input', (e) => {
    actualizarHistorial(e.target.value);
});

// Cargar la tabla apenas inicia
actualizarHistorial();

// ==========================================
// 1. BUSCADOR INTELIGENTE (SALDO + HISTORIAL)
// ==========================================
document.getElementById('user-name').addEventListener('input', (e) => {
    const nombreBuscado = e.target.value.trim();
    actualizarHistorial(nombreBuscado);
    
    if (nombreBuscado === "") {
        document.getElementById('deuda-total').innerText = "0";
        document.getElementById('deuda-total').style.color = "inherit";
        return;
    }

    db.collection("fotocopias")
        .where("userName", "==", nombreBuscado)
        .where("payMethod", "==", "Debe")
        .onSnapshot((querySnapshot) => {
            let total = 0;
            querySnapshot.forEach((doc) => {
                total += Number(doc.data().amount);
            });
            const displayDeuda = document.getElementById('deuda-total');
            displayDeuda.innerText = total;
            
            // Sugerencia: Alerta Deudor Crónico (Color rojo si debe más de $2000)
            displayDeuda.style.color = total >= 2000 ? "#e74c3c" : "#2ecc71";
            if(total >= 2000) displayDeuda.style.fontWeight = "bold";
        });
});

// ==========================================
// 2. HISTORIAL CON BOTÓN "SALDAR DEUDA"
// ==========================================
function actualizarHistorial(nombreFiltro = "") {
    const cuerpoTabla = document.getElementById('cuerpo-tabla');
    let consulta = db.collection("fotocopias").orderBy("fecha", "desc").limit(15);

    if (nombreFiltro !== "") {
        consulta = db.collection("fotocopias").where("userName", "==", nombreFiltro).orderBy("fecha", "desc");
    }

    consulta.onSnapshot((querySnapshot) => {
        cuerpoTabla.innerHTML = "";
        querySnapshot.forEach((doc) => {
            const dato = doc.data();
            const id = doc.id;
            const fecha = dato.fecha ? new Date(dato.fecha.seconds * 1000).toLocaleDateString('es-AR') : '---';
            const esDeuda = dato.payMethod === 'Debe';
            
            // Creamos la fila con un botón si es deuda
            cuerpoTabla.innerHTML += `
                <tr style="border-bottom: 1px solid #eee;">
                    <td style="padding: 8px;">${fecha}</td>
                    <td style="padding: 8px;">${dato.userName}</td>
                    <td style="padding: 8px;">$${dato.amount}</td>
                    <td style="padding: 8px; color: ${esDeuda ? '#e74c3c' : '#27ae60'}">
                        ${dato.payMethod}
                        ${esDeuda ? `<button onclick="saldarDeuda('${id}')" style="margin-left:5px; font-size:10px; cursor:pointer;">✅ Pagar</button>` : ''}
                    </td>
                </tr>
            `;
        });
    });
}

// Función para cambiar estado de 'Debe' a 'Pagado'
function saldarDeuda(docId) {
    if(confirm("¿Confirmas que el alumno pagó esta deuda?")) {
        db.collection("fotocopias").doc(docId).update({
            payMethod: "Efectivo"
        }).then(() => console.log("Deuda saldada"));
    }
}

// ==========================================
// 3. EXPORTAR INFORME MENSUAL (CSV)
// ==========================================
async function exportarCSV() {
    const querySnapshot = await db.collection("fotocopias").orderBy("fecha", "desc").get();
    let csvContent = "\ufeffFecha,Nombre,Curso,Monto,Metodo\n";

    querySnapshot.forEach((doc) => {
        const d = doc.data();
        const fecha = d.fecha ? new Date(d.fecha.seconds * 1000).toLocaleDateString('es-AR') : '---';
        csvContent += `${fecha},${d.userName},${d.userCourse || 'N/A'},${d.amount},${d.payMethod}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Informe_Fotocopias_${new Date().toLocaleDateString()}.csv`;
    link.click();
}

// ==========================================
// 4. RESUMEN DE CAJA DIARIO
// ==========================================
function calcularCajaDelDia() {
    const hoy = new Date();
    hoy.setHours(0,0,0,0);

    db.collection("fotocopias")
        .where("fecha", ">=", hoy)
        .onSnapshot((querySnapshot) => {
            let recaudado = 0;
            querySnapshot.forEach((doc) => {
                if(doc.data().payMethod !== "Debe") {
                    recaudado += Number(doc.data().amount);
                }
            });
            // Si tenés un elemento con id 'caja-dia', lo muestra ahí
            const cajaElement = document.getElementById('caja-dia');
            if(cajaElement) cajaElement.innerText = "Hoy se recaudó: $" + recaudado;
        });
}

// Iniciar funciones
actualizarHistorial();
calcularCajaDelDia();