// 1. Inicializar el mapa centrado en Amazonas (Chachapoyas)
const map = L.map('map').setView([-6.2295, -77.8712], 9);

// Cargar capas base
let tileLayerClaro = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
});
let tileLayerOscuro = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CartoDB'
});
tileLayerClaro.addTo(map);

// Lógica del Modo Oscuro
document.getElementById('btn-dark-mode').addEventListener('click', function () {
    document.body.classList.toggle('dark-mode');
    if (document.body.classList.contains('dark-mode')) {
        map.removeLayer(tileLayerClaro);
        tileLayerOscuro.addTo(map);
        this.innerText = '☀ Modo Claro';
    } else {
        map.removeLayer(tileLayerOscuro);
        tileLayerClaro.addTo(map);
        this.innerText = '🌙 Modo Oscuro';
    }
});

// Variables globales para el manejo de capas
let marcadoresGroup = L.layerGroup().addTo(map);
let rutaLineasGroup = L.layerGroup().addTo(map);
let todasLasFincas = []; // Aquí se guardarán los puntos REALES que devuelva Python

// Array auxiliar para mantener un rastreo ordenado e indexado de las instancias de los marcadores gráficos
let listaMarcadoresInstancias = [];

// 2. Función para cargar fincas
function recargarFincas() {
    const archivoKml = document.getElementById('selector-kml').value;
    const fecha = document.getElementById('fecha-ruta').value;
    const listaDiv = document.getElementById('lista-fincas');

    marcadoresGroup.clearLayers();
    rutaLineasGroup.clearLayers();
    if (listaDiv) listaDiv.innerHTML = "";
    todasLasFincas = [];
    listaMarcadoresInstancias = [];

    if (!archivoKml) {
        if (listaDiv) listaDiv.innerHTML = '<p style="color: #95a5a6; font-style: italic;">Selecciona una provincia para cargar las fincas...</p>';
        return;
    }

    if (listaDiv) listaDiv.innerHTML = '<p style="color: #3498db; font-style: italic;">Leyendo datos...</p>';

    // Obtener KML
    fetch('/api/cargar-kml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivo: archivoKml })
    })
    .then(response => response.json())
    .then(async puntos => {
        if (puntos.error) {
            if (listaDiv) listaDiv.innerHTML = `<p style="color: #e74c3c;">❌ ${puntos.error}</p>`;
            return;
        }

        let cargasDelDia = {};
        if (window.USER_ROLE === 'Conductor' && fecha) {
            try {
                const res = await fetch(`/api/cargas-por-fecha?fecha=${fecha}`);
                cargasDelDia = await res.json();
            } catch(e) { console.error(e); }
        }

        todasLasFincas = puntos;
        if (listaDiv) listaDiv.innerHTML = "";

        if (todasLasFincas.length > 0) {
            map.setView([todasLasFincas[0].lat, todasLasFincas[0].lng], 10);
        }

        todasLasFincas.forEach((finca, index) => {
            // Lógica Conductor: Si es finca (no centro acopio, index!=0) y carga es <= 0, no la mostramos
            if (window.USER_ROLE === 'Conductor' && index !== 0) {
                const carga = cargasDelDia[finca.nombre] || 0;
                if (carga <= 0) return; // Se salta esta iteración
            }

            const colorIcono = index === 0 ? 'green' : 'blue';
            const marker = L.marker([finca.lat, finca.lng], {
                icon: L.icon({
                    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${colorIcono}.png`,
                    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                    iconSize: [25, 41],
                    iconAnchor: [12, 41],
                    popupAnchor: [1, -34],
                    shadowSize: [41, 41]
                })
            }).bindPopup(`<b>${finca.nombre}</b><br>Lat: ${finca.lat}<br>Lng: ${finca.lng}`);

            listaMarcadoresInstancias[index] = marker;
            marcadoresGroup.addLayer(marker);

            if (listaDiv) {
                const item = document.createElement('div');
                item.className = 'finca-item';
                
                if (window.USER_ROLE === 'Conductor') {
                    // Ocultamos el checkbox visualmente pero dejamos su lógica intacta
                    item.innerHTML = `
                    <input type="checkbox" id="chk-${index}" value="${index}" checked style="display:none;">
                    <span style="color:#2ecc71; margin-right:8px; font-weight:bold;">✔</span>
                    <label for="chk-${index}">${finca.nombre}</label>
                    `;
                } else {
                    item.innerHTML = `
                    <input type="checkbox" id="chk-${index}" value="${index}" checked>
                    <label for="chk-${index}">${finca.nombre}</label>
                    `;
                }
                
                listaDiv.appendChild(item);

                const checkboxActual = item.querySelector(`#chk-${index}`);
                checkboxActual.addEventListener('change', function () {
                    if (this.checked) {
                        marcadoresGroup.addLayer(marker);
                    } else {
                        marcadoresGroup.removeLayer(marker);
                    }
                });
            }
        });
    })
    .catch(error => {
        console.error("Error:", error);
        if (listaDiv) listaDiv.innerHTML = '<p style="color: #e74c3c;">❌ Error al cargar datos.</p>';
    });
}

document.getElementById('selector-kml').addEventListener('change', recargarFincas);
document.getElementById('fecha-ruta').addEventListener('change', function() {
    if (window.USER_ROLE === 'Conductor' && document.getElementById('selector-kml').value) {
        recargarFincas();
    }
});
// 3. EVENTO CLIC: Enviar datos seleccionados dinámicamente a la API de cálculo
document.getElementById('btn-calcular').addEventListener('click', function () {
    rutaLineasGroup.clearLayers(); // Limpiar el trazo de la carretera anterior
    map.closePopup(); // Cierra cualquier popup abierto para evitar bloqueos de Leaflet

    // Limpiar tooltips de turnos anteriores de los marcadores para que no se dupliquen
    marcadoresGroup.eachLayer(function (layer) {
        if (layer.unbindTooltip) {
            layer.unbindTooltip();
        }
    });

    // Filtrar únicamente los puntos que el usuario dejó seleccionados mapeando sus índices originales
    const puntosAEnviar = [];
    const mapeoIndicesOriginales = [];

    todasLasFincas.forEach((finca, index) => {
        const chk = document.getElementById(`chk-${index}`);
        if (chk && chk.checked) {
            puntosAEnviar.push(finca);
            mapeoIndicesOriginales.push(index);
        }
    });

    if (puntosAEnviar.length < 2) {
        alert("Por favor, selecciona al menos 2 puntos (Empresa + 1 Finca).");
        return;
    }

    const resultadosTabla = document.getElementById('resultados-tabla');
    if (resultadosTabla) resultadosTabla.innerHTML = '<p style="color: #3498db; font-weight: bold;">⚡ Procesando algoritmos en el Backend...</p>';

    // Petición POST con el arreglo dinámico de puntos
    fetch('/api/calcular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            puntos: puntosAEnviar,
            inicio_idx: 0,
            fecha: document.getElementById('fecha-ruta').value
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                if (resultadosTabla) resultadosTabla.innerHTML = `<p style="color: #e74c3c;">❌ Error: ${data.error}</p>`;
                return;
            }

            // --- FUNCIÓN INTERNA: Convertir minutos u horas flotantes a formato amigable "X h Y min" ---
            const formatearTiempo = (minutosTotales) => {
                const horas = Math.floor(minutosTotales / 60);
                const minutos = Math.round(minutosTotales % 60);
                if (horas === 0) return `${minutos} min`;
                return `${horas} h ${minutos} min`;
            };

            // --- CONSTRUIR E IMPRIMIR TABLA COMPARATIVA ---
            let htmlTabla = `
            <table>
                <thead>
                    <tr>
                        <th>Algoritmo</th>
                        <th>Distancia</th>
                        <th>Tiempo (s)</th>
                    </tr>
                </thead>
                <tbody>
        `;

            data.comparativa.forEach(item => {
                const badge = item.proveedor === 'GOOGLE' ? 'badge-google' : 'badge-manual';
                const dist = typeof item.distancia_km === 'number' ? `${item.distancia_km} km` : item.distancia_km;
                htmlTabla += `
                <tr>
                    <td><span class="${badge}">${item.proveedor}</span><br>${item.algoritmo}</td>
                    <td><b>${dist}</b></td>
                    <td>${item.tiempo_seg}</td>
                </tr>
            `;
            });

            htmlTabla += `</tbody></table>`;
            if (resultadosTabla) resultadosTabla.innerHTML = htmlTabla;

            // --- MOSTRAR BOTONES DE EXPORTACIÓN Y GUARDAR DATOS EN VENTANA ---
            const exportBtns = document.getElementById('export-buttons');
            if (exportBtns) exportBtns.style.display = 'flex';
            window.datosReporteActual = data.comparativa;

            // Guardar para el dashboard de Analytics
            localStorage.setItem('tms_resultados', JSON.stringify(data));

            // --- SELECCIONAR MÉTRICAS DEL MEJOR ALGORITMO (GOOGLE) ---
            let mejorMetrica = data.comparativa.find(item => item.proveedor === 'GOOGLE');
            if (!mejorMetrica && data.comparativa.length > 0) {
                mejorMetrica = data.comparativa[0];
            }

            // --- TRAZAR MEJOR RUTA REAL RECOGIENDO LAS CURVAS VIALES ---
            const coordenadasCamino = data.camino_carretera_real;
            const ordenIndices = data.mejor_ruta_indices;
            const infoTramos = data.tramos_info;

            if (coordenadasCamino && coordenadasCamino.length > 0) {
                // 1. Dibujar la línea base de la carretera siguiendo el trazado real
                const polilineas = L.polyline(coordenadasCamino, {
                    color: '#e74c3c',
                    weight: 6,
                    opacity: 0.85,
                    lineJoin: 'round'
                }).addTo(rutaLineasGroup);

                // 2. CALCULAR MÉTRICAS TOTALES PRIMERO
                let distanciaTotalRuta = 0;
                let tiempoTotalRutaMin = 0;

                if (infoTramos && infoTramos.length > 0) {
                    infoTramos.forEach(tramo => {
                        distanciaTotalRuta += tramo.distancia_km;
                        tiempoTotalRutaMin += tramo.tiempo_min;
                    });
                }

                // 3. Recorrer el orden secuencial calculado para configurar Popups y Tooltips
                ordenIndices.forEach((indiceSubconjunto, posicionEnRuta) => {
                    const indiceRealMaestro = mapeoIndicesOriginales[indiceSubconjunto];
                    const fincaActual = todasLasFincas[indiceRealMaestro];

                    let layerEncontrado = listaMarcadoresInstancias[indiceRealMaestro];

                    if (!layerEncontrado) {
                        marcadoresGroup.eachLayer(function (layer) {
                            const latDiff = Math.abs(layer.getLatLng().lat - fincaActual.lat);
                            const lngDiff = Math.abs(layer.getLatLng().lng - fincaActual.lng);
                            if (latDiff < 0.0001 && lngDiff < 0.0001) {
                                layerEncontrado = layer;
                            }
                        });
                    }

                    if (layerEncontrado) {
                        if (posicionEnRuta === 0) {
                            // --- EL PIN VERDE SÓLO SE CONFIGURA AQUÍ (INICIO DE OPERACIÓN) ---
                            layerEncontrado.unbindPopup();

                            let secuenciaTexto = "";
                            ordenIndices.forEach((idx, i) => {
                                const idxOriginal = mapeoIndicesOriginales[idx];
                                const flecha = i < ordenIndices.length - 1 ? " ➔ " : "";
                                secuenciaTexto += `<span><b>${i + 1}.</b> ${todasLasFincas[idxOriginal].nombre}</span>${flecha ? '<br>' : ''}`;
                            });

                            const datosEmpresaBase = todasLasFincas[mapeoIndicesOriginales[0]];

                            const contenidoAcopio = `
                            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; min-width: 290px; padding: 2px;">
                                <h4 style="margin: 0 0 8px 0; color: #27ae60; border-bottom: 2px solid #2ecc71; padding-bottom: 4px; font-size: 1.1rem;">
                                    🟢 CENTRO DE ACOPIO 
                                </h4>
                                
                                <div style="background: #ebf7ee; border-left: 4px solid #2ecc71; padding: 8px; border-radius: 4px; margin-bottom: 10px; font-size: 0.85rem; line-height: 1.5;">
                                    📊 <b>Métricas de Distribución (Google OR-Tools):</b><br>
                                    🛣️ <b>Distancia Total Completa:</b> <span style="color: #27ae60; font-weight:bold;">${distanciaTotalRuta.toFixed(2)} km</span><br>
                                    ⏱️ <b>Tiempo Estimado Vial:</b> <span style="color: #27ae60; font-weight:bold;">${formatearTiempo(tiempoTotalRutaMin)}</span>
                                </div>

                                <div style="font-size: 0.85rem; color: #2c3e50; line-height: 1.4; margin-bottom: 10px;">
                                    📋 <b>Secuencia Cronológica a Seguir:</b><br>
                                    <div style="margin-top: 4px; padding: 6px; max-height: 100px; overflow-y:auto; border: 1px solid #e6e9ed; background: #fafbfc; border-radius: 4px; font-size: 0.8rem; line-height: 1.5;">
                                        ${secuenciaTexto}
                                    </div>
                                </div>

                                <div style="border-top: 1px dashed #ccd1d9; padding-top: 8px; margin-top: 5px; font-size: 0.75rem; color: #555e6b; line-height: 1.4;">
                                    🏢 <b>Entidad Base:</b> ${datosEmpresaBase.nombre}<br>
                                    📍 <b>Ubicación:</b> Lat ${datosEmpresaBase.lat.toFixed(5)} , Lng ${datosEmpresaBase.lng.toFixed(5)}
                                </div>
                            </div>
                        `;

                            layerEncontrado.bindPopup(contenidoAcopio).openPopup();

                        } else {
                            // --- PINES AZULES (FINCAS INTERMEDIAS) ---
                            // PROTECCIÓN CRÍTICA: Bloquea que el último paso de retorno pise los datos del Acopio
                            const esDestinoFinal = (posicionEnRuta === ordenIndices.length - 1 && indiceSubconjunto === 0);

                            if (!esDestinoFinal) {
                                layerEncontrado.unbindPopup();

                                const indiceAnteriorSub = ordenIndices[posicionEnRuta - 1];
                                const indiceAnteriorReal = mapeoIndicesOriginales[indiceAnteriorSub];

                                const puntoAnterior = todasLasFincas[indiceAnteriorReal];
                                const tramoMetricas = infoTramos[posicionEnRuta - 1];
                                const tituloPopup = `📍 Turno #${posicionEnRuta} de Entrega`;

                                const contenidoPopup = `
                                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; min-width: 220px;">
                                    <h4 style="margin: 0 0 8px 0; color: #2c3e50; border-bottom: 2px solid #e74c3c; padding-bottom: 3px; font-size: 1rem;">
                                        ${tituloPopup}
                                    </h4>
                                    <p style="margin: 4px 0; font-size: 0.85rem; color: #34495e;">
                                        <b>Origen:</b> ${puntoAnterior.nombre}<br>
                                        <b>Destino:</b> ${fincaActual.nombre}
                                    </p>
                                    <div style="background: #f8f9fa; border-left: 4px solid #e74c3c; padding: 6px; border-radius: 4px; margin-top: 8px; font-size: 0.85rem;">
                                        🚗 <b>Longitud de Tramo:</b> ${tramoMetricas.distancia_km} km<br>
                                        ⏱️ <b>Demora Estimada:</b> ${formatearTiempo(tramoMetricas.tiempo_min)}
                                    </div>
                                </div>
                            `;

                                layerEncontrado.bindPopup(contenidoPopup);

                                layerEncontrado.bindTooltip(`<b>Turno #${posicionEnRuta}</b>`, {
                                    permanent: true,
                                    direction: 'top',
                                    className: 'badge-orden'
                                }).openTooltip();
                            }
                        }
                    }
                });

                map.fitBounds(polilineas.getBounds());
                
                // Mostrar panel de control de viaje (solo si existe en el DOM)
                const ctrlViaje = document.getElementById('control-viaje');
                if (ctrlViaje) ctrlViaje.style.display = 'block';

            } else {
                alert("Nota: Mostrando ruta en línea recta debido a una interrupción con el servidor vial.");
                const coordenadasLineaRecta = [];
                ordenIndices.forEach(idx => {
                    const realIdx = mapeoIndicesOriginales[idx];
                    const p = todasLasFincas[realIdx];
                    coordenadasLineaRecta.push([p.lat, p.lng]);
                });

                const polilineasRectas = L.polyline(coordenadasLineaRecta, {
                    color: '#ef5350',
                    weight: 4,
                    dashArray: '5, 10'
                }).addTo(rutaLineasGroup);

                map.fitBounds(polilineasRectas.getBounds());
            }
        })
        .catch(error => {
            console.error("Error en el proceso de cálculo:", error);
            const resTab = document.getElementById('resultados-tabla');
            if (resTab) {
                resTab.innerHTML = `
                <div style="color: #e74c3c; padding: 10px; border: 1px solid #e74c3c; background: #fdf2f2; border-radius: 6px;">
                    <b>❌ Error detectado en el Frontend:</b><br>
                    <code style="display:block; margin-top:5px; font-family:monospace;">${error.message}</code>
                </div>
            `;
            }
        });
});

// --- ALGORITMOS DE BÚSQUEDA Y ORDENAMIENTO (FRONTEND) ---

// 1. Merge Sort: Ordena un arreglo de fincas alfabéticamente por su nombre
function mergeSortFincas(arr) {
    if (arr.length <= 1) return arr;
    const mid = Math.floor(arr.length / 2);
    const left = mergeSortFincas(arr.slice(0, mid));
    const right = mergeSortFincas(arr.slice(mid));
    return mergeFincas(left, right);
}

function mergeFincas(left, right) {
    let result = [];
    let i = 0; let j = 0;
    while (i < left.length && j < right.length) {
        if (left[i].nombre.toLowerCase() < right[j].nombre.toLowerCase()) {
            result.push(left[i]);
            i++;
        } else {
            result.push(right[j]);
            j++;
        }
    }
    return result.concat(left.slice(i)).concat(right.slice(j));
}

// 2. Búsqueda Binaria: Busca una finca por nombre en un arreglo ordenado
function busquedaBinariaFincas(arrOrdenado, textoBuscado) {
    let inicio = 0;
    let fin = arrOrdenado.length - 1;
    let textoLower = textoBuscado.toLowerCase();

    while (inicio <= fin) {
        let medio = Math.floor((inicio + fin) / 2);
        let nombreMedio = arrOrdenado[medio].nombre.toLowerCase();

        // Comprobación de coincidencia exacta o parcial al inicio
        if (nombreMedio.includes(textoLower)) {
            return arrOrdenado[medio];
        }

        if (nombreMedio < textoLower) {
            inicio = medio + 1;
        } else {
            fin = medio - 1;
        }
    }

    // Si no encuentra coincidencia con la lógica estricta, intentamos un fallback lineal parcial
    // (Útil porque el usuario podría escribir "maria" para "Finca Maria")
    return arrOrdenado.find(f => f.nombre.toLowerCase().includes(textoLower));
}

// 3. Evento del botón de búsqueda
document.getElementById('btn-buscar').addEventListener('click', function () {
    const texto = document.getElementById('input-busqueda').value.trim();
    if (!texto) {
        alert("Ingresa un nombre para buscar.");
        return;
    }

    if (todasLasFincas.length === 0) {
        alert("Primero selecciona una provincia para cargar las fincas.");
        return;
    }

    // a. Ordenamos la copia de todas las fincas usando Merge Sort nativo
    const fincasCopia = [...todasLasFincas];
    const fincasOrdenadas = mergeSortFincas(fincasCopia);

    // b. Buscamos la finca usando Búsqueda Binaria
    const fincaEncontrada = busquedaBinariaFincas(fincasOrdenadas, texto);

    if (fincaEncontrada) {
        // Encontrar su índice real original para ubicar el marcador visual en Leaflet
        const indexReal = todasLasFincas.findIndex(f => f.nombre === fincaEncontrada.nombre);
        if (indexReal !== -1 && listaMarcadoresInstancias[indexReal]) {
            // Zoom hacia la finca y mostrar su popup
            map.flyTo([fincaEncontrada.lat, fincaEncontrada.lng], 16, { duration: 1.5 });
            setTimeout(() => {
                listaMarcadoresInstancias[indexReal].openPopup();
            }, 1500);
        }
    } else {
        alert("No se encontró ninguna finca con ese nombre.");
    }
});

// --- FUNCIONES DE EXPORTACIÓN DE REPORTES ---

// Preparar los datos tabulares limpios
function prepararDatosExportacion() {
    if (!window.datosReporteActual || window.datosReporteActual.length === 0) {
        return [];
    }
    const fecha = new Date().toLocaleString('es-PE');

    let filas = [];
    filas.push(["REPORTE DE OPTIMIZACIÓN LOGÍSTICA - AMAZONAS"]);
    filas.push([`Fecha de generación: ${fecha}`]);
    filas.push([]);
    filas.push(["Proveedor", "Algoritmo", "Distancia (km)", "Tiempo CPU (s)"]);

    window.datosReporteActual.forEach(item => {
        filas.push([
            item.proveedor,
            item.algoritmo,
            typeof item.distancia_km === 'number' ? item.distancia_km : item.distancia_km,
            item.tiempo_seg
        ]);
    });

    return filas;
}

// Exportar a CSV nativo
const btnCsv = document.getElementById('btn-export-csv');
if (btnCsv) {
    btnCsv.addEventListener('click', function () {
        const filas = prepararDatosExportacion();
        if (filas.length === 0) return alert("No hay datos para exportar");

        let csvContent = "data:text/csv;charset=utf-8,"
            + filas.map(e => e.join(",")).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "reporte_rutas_amazonas.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}

// Exportar a Excel usando SheetJS
const btnExcel = document.getElementById('btn-export-excel');
if (btnExcel) {
    btnExcel.addEventListener('click', function () {
        const filas = prepararDatosExportacion();
        if (filas.length === 0) return alert("No hay datos para exportar");

        const ws = XLSX.utils.aoa_to_sheet(filas);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Reporte_Logistico");

        XLSX.writeFile(wb, "reporte_rutas_amazonas.xlsx");
    });
}

// Exportar a PDF usando html2pdf
document.getElementById('btn-export-pdf').addEventListener('click', function () {
    const rawData = localStorage.getItem('tms_resultados');
    if (!rawData) return alert("No hay datos calculados para exportar.");
    
    const data = JSON.parse(rawData);
    if (!data.comparativa || data.comparativa.length === 0) return alert("Sin datos.");

    // Seleccionar el algoritmo principal (el mismo criterio del dashboard)
    let mejorMetrica = data.comparativa.find(item => item.proveedor === 'GOOGLE');
    if (!mejorMetrica) mejorMetrica = data.comparativa[0];

    const tms = data.tms || {};
    const vehiculo = tms.vehiculo_asignado;
    const cargaTotal = tms.carga_total_kg || 0;
    
    let vehiculoHtml = '<p style="color:#e74c3c;">No se asignó ningún vehículo.</p>';
    if (vehiculo) {
        vehiculoHtml = `
            <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; text-align: left;">
                <tr style="background-color: #f2f6f8;">
                    <th style="padding: 8px; border: 1px solid #ddd; width: 30%;">Vehículo Asignado</th>
                    <td style="padding: 8px; border: 1px solid #ddd;">${vehiculo.marca} ${vehiculo.modelo} (Placa: ${vehiculo.placa})</td>
                </tr>
                <tr>
                    <th style="padding: 8px; border: 1px solid #ddd;">Combustible</th>
                    <td style="padding: 8px; border: 1px solid #ddd;">${vehiculo.tipo_combustible}</td>
                </tr>
                <tr style="background-color: #f2f6f8;">
                    <th style="padding: 8px; border: 1px solid #ddd;">Carga Total a Transportar</th>
                    <td style="padding: 8px; border: 1px solid #ddd;">${cargaTotal} Kg</td>
                </tr>
                <tr>
                    <th style="padding: 8px; border: 1px solid #ddd;">Costo Estimado de Ruta</th>
                    <td style="padding: 8px; border: 1px solid #ddd;"><b>S/ ${mejorMetrica.costo_operativo_soles || '0.00'}</b></td>
                </tr>
            </table>
        `;
    }

    const contenedorTemporal = document.createElement('div');
    contenedorTemporal.style.padding = '30px';
    contenedorTemporal.style.fontFamily = 'Helvetica, Arial, sans-serif';
    contenedorTemporal.style.color = '#333';

    const fecha = new Date().toLocaleString('es-PE');
    let htmlContent = `
        <div style="text-align: center; margin-bottom: 20px;">
            <h1 style="color: #2c3e50; font-size: 24px; border-bottom: 2px solid #3498db; padding-bottom: 10px;">Hoja de Ruta TMS - Amazonas</h1>
            <p style="color: #7f8c8d; font-size: 14px;">Fecha de emisión: ${fecha}</p>
        </div>
        
        <h3 style="color: #2980b9; margin-top: 20px;">1. Detalles del Vehículo y Costos</h3>
        ${vehiculoHtml}

        <h3 style="color: #2980b9; margin-top: 30px;">2. Detalles del Algoritmo Óptimo</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
            <thead>
                <tr style="background-color: #34495e; color: white; text-align: left;">
                    <th style="padding: 10px; border: 1px solid #ddd;">Motor de Rutas</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Distancia Total</th>
                    <th style="padding: 10px; border: 1px solid #ddd;">Tiempo de Cálculo CPU</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd;"><b>${mejorMetrica.proveedor}</b><br><span style="font-size:12px;">${mejorMetrica.algoritmo}</span></td>
                    <td style="padding: 10px; border: 1px solid #ddd; font-weight:bold;">${mejorMetrica.distancia_km} km</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${mejorMetrica.tiempo_seg} seg</td>
                </tr>
            </tbody>
        </table>

        <div style="margin-top: 50px; text-align: center; font-size: 12px; color: #95a5a6; border-top: 1px solid #eee; padding-top: 20px;">
            Generado automáticamente por el Sistema Web GIS de Optimización de Rutas Cafetaleras.<br>
            <i>Documento válido para el transportista.</i>
        </div>
    `;

    contenedorTemporal.innerHTML = htmlContent;

    const opt = {
        margin: 10,
        filename: 'Hoja_de_Ruta_Conductor.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(contenedorTemporal).save();
});

// --- LÓGICA DE CONTROL DE RUTA (VIAJES) ---
let timerInterval;

function initRouteControl() {
    const btnIniciar = document.getElementById('btn-iniciar-ruta');
    const btnFinalizar = document.getElementById('btn-finalizar-ruta');
    const timerDisplay = document.getElementById('viaje-timer');
    const ctrlViaje = document.getElementById('control-viaje');
    
    if (!btnIniciar || !btnFinalizar || !timerDisplay || !ctrlViaje) return;

    // Recuperar estado previo si recarga la página
    const activeViaje = localStorage.getItem('active_viaje_id');
    const activeInicio = localStorage.getItem('active_viaje_inicio');
    
    if (activeViaje && activeInicio) {
        ctrlViaje.style.display = 'block';
        btnIniciar.style.display = 'none';
        btnFinalizar.style.display = 'block';
        startTimer(activeInicio);
    }

    btnIniciar.addEventListener('click', () => {
        // Obtenemos los datos actuales desde tms_resultados
        const dataStr = localStorage.getItem('tms_resultados');
        if (!dataStr) {
            alert("No hay datos de ruta disponibles. Calcula una ruta primero.");
            return;
        }
        const data = JSON.parse(dataStr);
        const tms = data.tms || {};
        const vehiculo_id = tms.vehiculo_asignado ? tms.vehiculo_asignado.id : null;
        const kg_totales = tms.carga_total_kg || 0;
        
        if(!vehiculo_id) {
            alert("No hay un vehículo asignado para esta ruta.");
            return;
        }

        fetch('/api/viaje/iniciar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vehiculo_id, kg_totales })
        }).then(res => res.json()).then(resp => {
            if (resp.error) {
                alert(resp.error);
                return;
            }
            // Iniciar ruta
            localStorage.setItem('active_viaje_id', resp.viaje_id);
            localStorage.setItem('active_viaje_inicio', resp.hora_inicio);
            
            btnIniciar.style.display = 'none';
            btnFinalizar.style.display = 'block';
            startTimer(resp.hora_inicio);
        });
    });

    btnFinalizar.addEventListener('click', () => {
        const viaje_id = localStorage.getItem('active_viaje_id');
        if(!viaje_id) return;
        
        mostrarModalConfirmacion(
            "¿Finalizar Ruta?", 
            "¿Confirmas que has llegado a todos los destinos y deseas finalizar la ruta?", 
            () => {
                fetch('/api/viaje/finalizar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ viaje_id })
                }).then(res => res.json()).then(resp => {
                    if(resp.error) {
                        alert(resp.error);
                        return;
                    }
                    // Limpiar estado
                    clearInterval(timerInterval);
                    localStorage.removeItem('active_viaje_id');
                    localStorage.removeItem('active_viaje_inicio');
                    
                    btnFinalizar.style.display = 'none';
                    btnIniciar.style.display = 'block';
                    timerDisplay.innerText = "00:00:00";
                    ctrlViaje.style.display = 'none';
                    
                    mostrarModalExito("¡Ruta Finalizada!", "Ruta logística registrada con éxito.");
                });
            }
        );
    });
}

function mostrarModalConfirmacion(titulo, mensaje, onConfirm) {
    const modal = document.getElementById('modal-animado');
    document.getElementById('modal-icono').innerHTML = '❓';
    document.getElementById('modal-icono').style.fontSize = '50px';
    document.getElementById('modal-titulo').innerText = titulo;
    document.getElementById('modal-mensaje').innerText = mensaje;
    
    document.getElementById('modal-botones').innerHTML = `
        <button id="btn-modal-confirm" class="modal-btn">Aceptar</button>
        <button id="btn-modal-cancel" class="modal-btn cancel">Cancelar</button>
    `;
    
    modal.classList.add('active');
    
    document.getElementById('btn-modal-cancel').onclick = () => {
        modal.classList.remove('active');
    };
    
    document.getElementById('btn-modal-confirm').onclick = () => {
        modal.classList.remove('active');
        onConfirm();
    };
}

function mostrarModalExito(titulo, mensaje) {
    const modal = document.getElementById('modal-animado');
    document.getElementById('modal-icono').innerHTML = `
        <svg class="checkmark-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
            <circle class="checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
            <path class="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
        </svg>
    `;
    document.getElementById('modal-titulo').innerText = titulo;
    document.getElementById('modal-mensaje').innerText = mensaje;
    
    document.getElementById('modal-botones').innerHTML = `
        <button id="btn-modal-ok" class="modal-btn">OK</button>
    `;
    
    modal.classList.add('active');
    
    document.getElementById('btn-modal-ok').onclick = () => {
        modal.classList.remove('active');
    };
}

function startTimer(startTimeIso) {
    const startTime = new Date(startTimeIso).getTime();
    const timerDisplay = document.getElementById('viaje-timer');
    
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const now = new Date().getTime();
        const diff = now - startTime;
        
        const h = Math.floor(diff / (1000 * 60 * 60));
        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((diff % (1000 * 60)) / 1000);
        
        timerDisplay.innerText = 
            String(h).padStart(2, '0') + ":" + 
            String(m).padStart(2, '0') + ":" + 
            String(s).padStart(2, '0');
    }, 1000);
}

// Inicializar en DOM load
document.addEventListener('DOMContentLoaded', initRouteControl);