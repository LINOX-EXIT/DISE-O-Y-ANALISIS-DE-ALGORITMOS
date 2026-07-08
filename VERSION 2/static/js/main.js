// 1. Inicializar el mapa centrado en Amazonas (Chachapoyas)
const map = L.map('map').setView([-6.2295, -77.8712], 9);

// Cargar capa base de OpenStreetMap (Mapas gratuitos)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Variables globales para el manejo de capas
let marcadoresGroup = L.layerGroup().addTo(map);
let rutaLineasGroup = L.layerGroup().addTo(map);
let todasLasFincas = []; // Aquí se guardarán los puntos REALES que devuelva Python

// Array auxiliar para mantener un rastreo ordenado e indexado de las instancias de los marcadores gráficos
let listaMarcadoresInstancias = [];

// 2. Detectar cambio de Provincia en el Selector y pedir datos reales al Backend
document.getElementById('selector-kml').addEventListener('change', function (e) {
    const archivoKml = e.target.value;
    const listaDiv = document.getElementById('lista-fincas');

    // Limpiar mapa y panel de control por completo
    marcadoresGroup.clearLayers();
    rutaLineasGroup.clearLayers();
    if (listaDiv) listaDiv.innerHTML = "";
    todasLasFincas = [];
    listaMarcadoresInstancias = []; // Resetear instancias

    if (!archivoKml) {
        if (listaDiv) listaDiv.innerHTML = '<p style="color: #95a5a6; font-style: italic;">Selecciona una provincia para cargar las fincas...</p>';
        return;
    }

    if (listaDiv) listaDiv.innerHTML = '<p style="color: #3498db; font-style: italic;">Leyendo archivo KML real...</p>';

    // Hacemos la petición al Backend para que lea el archivo KML del disco
    fetch('/api/cargar-kml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archivo: archivoKml })
    })
        .then(response => response.json())
        .then(puntos => {
            if (puntos.error) {
                if (listaDiv) listaDiv.innerHTML = `<p style="color: #e74c3c;">❌ ${puntos.error}</p>`;
                return;
            }

            todasLasFincas = puntos;
            if (listaDiv) listaDiv.innerHTML = ""; // Limpiar mensaje de carga

            // Enfocar el mapa automáticamente en el primer punto del archivo KML real (Centro de Acopio)
            if (todasLasFincas.length > 0) {
                map.setView([todasLasFincas[0].lat, todasLasFincas[0].lng], 10);
            }

            // Dibujar los checkboxes laterales y los marcadores en el mapa
            todasLasFincas.forEach((finca, index) => {
                // Determinar color (Verde para el punto de inicio/Empresa, Azul para las fincas)
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

                // Guardamos la referencia indexada para ubicar el objeto exacto en memoria velozmente después
                listaMarcadoresInstancias[index] = marker;
                marcadoresGroup.addLayer(marker);

                // Crear el elemento visual en la barra lateral
                if (listaDiv) {
                    const item = document.createElement('div');
                    item.className = 'finca-item';
                    item.innerHTML = `
                    <input type="checkbox" id="chk-${index}" value="${index}" checked>
                    <label for="chk-${index}">${finca.nombre}</label>
                `;
                    listaDiv.appendChild(item);

                    // --- MEJORA: OCULTAR/MOSTRAR PIN EN TIEMPO REAL ---
                    const checkboxActual = item.querySelector(`#chk-${index}`);
                    checkboxActual.addEventListener('change', function () {
                        if (this.checked) {
                            // Si el usuario activa el check, volvemos a poner el marcador en el mapa
                            marcadoresGroup.addLayer(marker);
                        } else {
                            // Si desactiva el check, removemos el marcador del mapa de inmediato
                            marcadoresGroup.removeLayer(marker);
                        }
                    });
                }
            });
        })
        .catch(error => {
            console.error("Error al cargar KML:", error);
            if (listaDiv) listaDiv.innerHTML = '<p style="color: #e74c3c;">❌ Error al conectar con el lector KML.</p>';
        });
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
            inicio_idx: 0
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
document.getElementById('btn-buscar').addEventListener('click', function() {
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