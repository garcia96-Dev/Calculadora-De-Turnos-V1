import React, { useState, useMemo, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, KeyboardAvoidingView, ScrollView, Alert, TextInput, StatusBar, Platform, Modal, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import dayjs from 'dayjs';
import 'dayjs/locale/es';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import AsyncStorage from '@react-native-async-storage/async-storage'; 
import DateTimePicker from '@react-native-community/datetimepicker';

dayjs.extend(customParseFormat);
dayjs.locale('es');

LocaleConfig.locales['es'] = {
  monthNames: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  monthNamesShort: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  dayNames: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  dayNamesShort: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  today: 'Hoy'
};
LocaleConfig.defaultLocale = 'es';

const STORAGE_KEY = '@mis_turnos';
const CONFIG_KEY = '@config_app';

// --- FESTIVOS DE COLOMBIA ---

// Calcula el Domingo de Pascua para un año (algoritmo de Gauss/Meeus)
const calcularDomingoDePascua = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return dayjs(new Date(year, mes - 1, dia));
};

// Ley Emiliani: traslada un festivo al lunes siguiente (si ya es lunes, no se mueve)
const trasladarAlLunesSiguiente = (fecha) => {
  const diasHastaLunes = (8 - fecha.day()) % 7;
  return fecha.add(diasHastaLunes, 'day');
};

// Cache simple para no recalcular los festivos del mismo año varias veces
const cacheFestivos = {};

const obtenerFestivosColombia = (year) => {
  if (cacheFestivos[year]) return cacheFestivos[year];

  const pascua = calcularDomingoDePascua(year);

  // Festivos fijos: no se trasladan con la Ley Emiliani
  const festivosFijos = [
    dayjs(new Date(year, 0, 1)),   // Año Nuevo
    dayjs(new Date(year, 4, 1)),   // Día del Trabajo
    dayjs(new Date(year, 6, 20)),  // Independencia
    dayjs(new Date(year, 7, 7)),   // Batalla de Boyacá
    dayjs(new Date(year, 11, 8)),  // Inmaculada Concepción
    dayjs(new Date(year, 11, 25)), // Navidad
  ];

  // Festivos que se trasladan al lunes siguiente (Ley Emiliani)
  const festivosEmiliani = [
    dayjs(new Date(year, 0, 6)),   // Reyes Magos
    dayjs(new Date(year, 2, 19)),  // San José
    pascua.add(43, 'day'),         // Ascensión del Señor
    pascua.add(64, 'day'),         // Corpus Christi
    pascua.add(71, 'day'),         // Sagrado Corazón de Jesús
    dayjs(new Date(year, 5, 29)),  // San Pedro y San Pablo
    dayjs(new Date(year, 7, 15)),  // Asunción de la Virgen
    dayjs(new Date(year, 9, 12)),  // Día de la Raza
    dayjs(new Date(year, 10, 1)),  // Todos los Santos
    dayjs(new Date(year, 10, 11)), // Independencia de Cartagena
  ].map(trasladarAlLunesSiguiente);

  // Festivos de Semana Santa: se celebran en su día real, no se trasladan
  const festivosSemanaSanta = [
    pascua.subtract(3, 'day'), // Jueves Santo
    pascua.subtract(2, 'day'), // Viernes Santo
  ];

  const todos = [...festivosFijos, ...festivosEmiliani, ...festivosSemanaSanta]
    .map(f => f.format('YYYY-MM-DD'));

  cacheFestivos[year] = todos;
  return todos;
};

// true si la fecha (YYYY-MM-DD) es domingo o festivo en Colombia
const esDominicalOFestivo = (fechaStr) => {
  const fecha = dayjs(fechaStr);
  if (fecha.day() === 0) return true; // Domingo
  const festivosDelAnio = obtenerFestivosColombia(fecha.year());
  return festivosDelAnio.includes(fechaStr);
};

// Convierte texto ingresado por el usuario a número, aceptando coma o punto como
// separador decimal (ej: "8,5" o "8.5"). Devuelve NaN si el formato no es válido,
// para que el llamador pueda mostrar un mensaje de error claro.
const parsearDecimal = (texto) => {
  if (typeof texto !== 'string') return NaN;
  const normalizado = texto.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalizado)) return NaN;
  return parseFloat(normalizado);
};

export default function App() {
  const [fechaSeleccionada, setFechaSeleccionada] = useState(dayjs().format('YYYY-MM-DD'));
  const [horaEntrada, setHoraEntrada] = useState(''); 
  const [horaSalida, setHoraSalida] = useState('');   
  const [jornadaLaboral, setJornadaLaboral] = useState('8');
  const [resultado, setResultado] = useState(null);
  const [turnosGuardados, setTurnosGuardados] = useState({});
  const [mostrarModalCalendario, setMostrarModalCalendario] = useState(false);
  const [mostrarModalRegistro, setMostrarModalRegistro] = useState(false);

  const [mostrarRelojEntrada, setMostrarRelojEntrada] = useState(false);
  const [mostrarRelojSalida, setMostrarRelojSalida] = useState(false);

  // --- Rango de fechas para el resumen (por defecto: mes actual) ---
  const [rangoInicio, setRangoInicio] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [rangoFin, setRangoFin] = useState(dayjs().endOf('month').format('YYYY-MM-DD'));
  const [mostrarSelectorInicio, setMostrarSelectorInicio] = useState(false);
  const [mostrarSelectorFin, setMostrarSelectorFin] = useState(false);

  // --- Configuración (horario nocturno editable y festivos personalizados) ---
  const [mostrarConfiguracion, setMostrarConfiguracion] = useState(false);
  const [horaInicioNocturno, setHoraInicioNocturno] = useState('19:00');
  const [horaFinNocturno, setHoraFinNocturno] = useState('06:00');
  const [festivosPersonalizados, setFestivosPersonalizados] = useState([]);
  const [mostrarRelojInicioNocturno, setMostrarRelojInicioNocturno] = useState(false);
  const [mostrarRelojFinNocturno, setMostrarRelojFinNocturno] = useState(false);
  const [mostrarSelectorFestivo, setMostrarSelectorFestivo] = useState(false);

  useEffect(() => {
    cargarTurnosDesdememoria();
    cargarConfiguracion();
  }, []);

  const cargarConfiguracion = async () => {
    try {
      const configString = await AsyncStorage.getItem(CONFIG_KEY);
      if (configString !== null) {
        const config = JSON.parse(configString);
        if (config.horaInicioNocturno) setHoraInicioNocturno(config.horaInicioNocturno);
        if (config.horaFinNocturno) setHoraFinNocturno(config.horaFinNocturno);
        if (Array.isArray(config.festivosPersonalizados)) setFestivosPersonalizados(config.festivosPersonalizados);
      }
    } catch (error) {
      console.error("Error al cargar configuración:", error);
    }
  };

  const guardarConfiguracion = async (nuevaConfig) => {
    try {
      await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(nuevaConfig));
    } catch (error) {
      Alert.alert("Error", "No se pudo guardar la configuración.");
    }
  };

  const cargarTurnosDesdememoria = async () => {
    try {
      const datosString = await AsyncStorage.getItem(STORAGE_KEY);
      if (datosString !== null) {
        const datosParseados = JSON.parse(datosString);
        setTurnosGuardados(datosParseados);
        
        const hoy = dayjs().format('YYYY-MM-DD');
        if (datosParseados[hoy]) {
          setResultado(datosParseados[hoy]);
          setHoraEntrada(datosParseados[hoy].horaEntradaGuardada);
          setHoraSalida(datosParseados[hoy].horaSalidaGuardada);
        }
      }
    } catch (error) {
      console.error("Error al cargar:", error);
    }
  };

  const guardarTurnoEnMemoria = async (nuevosTurnos) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nuevosTurnos));
    } catch (error) {
      Alert.alert("Error", "No se pudo guardar.");
    }
  };

  const convertirTextoAFecha = (textoHora) => {
    if (!textoHora) return new Date();
    const [horas, minutos] = textoHora.split(':');
    const fecha = new Date();
    fecha.setHours(parseInt(horas), parseInt(minutos), 0, 0);
    return fecha;
  };

  const alCambiarEntrada = (event, fechaSeleccionada) => {
    setMostrarRelojEntrada(false);
    if (fechaSeleccionada) {
      setHoraEntrada(dayjs(fechaSeleccionada).format('HH:mm'));
    }
  };

  const alCambiarSalida = (event, fechaSeleccionada) => {
    setMostrarRelojSalida(false);
    if (fechaSeleccionada) {
      setHoraSalida(dayjs(fechaSeleccionada).format('HH:mm'));
    }
  };

  const alCambiarRangoInicio = (event, fecha) => {
    setMostrarSelectorInicio(false);
    if (fecha) {
      const nuevoInicio = dayjs(fecha).format('YYYY-MM-DD');
      setRangoInicio(nuevoInicio);
      if (dayjs(nuevoInicio).isAfter(dayjs(rangoFin))) setRangoFin(nuevoInicio);
    }
  };

  const alCambiarRangoFin = (event, fecha) => {
    setMostrarSelectorFin(false);
    if (fecha) {
      const nuevoFin = dayjs(fecha).format('YYYY-MM-DD');
      setRangoFin(nuevoFin);
      if (dayjs(nuevoFin).isBefore(dayjs(rangoInicio))) setRangoInicio(nuevoFin);
    }
  };

  const alCambiarHoraInicioNocturno = (event, fecha) => {
    setMostrarRelojInicioNocturno(false);
    if (fecha) {
      const nuevoValor = dayjs(fecha).format('HH:mm');
      setHoraInicioNocturno(nuevoValor);
      guardarConfiguracion({ horaInicioNocturno: nuevoValor, horaFinNocturno, festivosPersonalizados });
    }
  };

  const alCambiarHoraFinNocturno = (event, fecha) => {
    setMostrarRelojFinNocturno(false);
    if (fecha) {
      const nuevoValor = dayjs(fecha).format('HH:mm');
      setHoraFinNocturno(nuevoValor);
      guardarConfiguracion({ horaInicioNocturno, horaFinNocturno: nuevoValor, festivosPersonalizados });
    }
  };

  const alAgregarFestivoPersonalizado = (event, fecha) => {
    setMostrarSelectorFestivo(false);
    if (fecha) {
      const fechaStr = dayjs(fecha).format('YYYY-MM-DD');
      if (festivosPersonalizados.includes(fechaStr)) {
        Alert.alert("Ya existe", "Esa fecha ya está en tu lista de festivos personalizados.");
        return;
      }
      const nuevaLista = [...festivosPersonalizados, fechaStr].sort();
      setFestivosPersonalizados(nuevaLista);
      guardarConfiguracion({ horaInicioNocturno, horaFinNocturno, festivosPersonalizados: nuevaLista });
    }
  };

  const eliminarFestivoPersonalizado = (fechaStr) => {
    const nuevaLista = festivosPersonalizados.filter(f => f !== fechaStr);
    setFestivosPersonalizados(nuevaLista);
    guardarConfiguracion({ horaInicioNocturno, horaFinNocturno, festivosPersonalizados: nuevaLista });
  };

  // true si el minuto del día (0-1439) cae dentro del horario nocturno configurado
  const esMinutoNocturno = (horaDelReloj, minutoDelReloj) => {
    const minutosDelDia = horaDelReloj * 60 + minutoDelReloj;
    const [hInicio, mInicio] = horaInicioNocturno.split(':').map(Number);
    const [hFin, mFin] = horaFinNocturno.split(':').map(Number);
    const inicioMin = hInicio * 60 + mInicio;
    const finMin = hFin * 60 + mFin;
    if (inicioMin > finMin) {
      // El rango nocturno cruza la medianoche (caso típico, ej: 19:00 a 06:00)
      return minutosDelDia >= inicioMin || minutosDelDia < finMin;
    }
    // Rango nocturno que no cruza medianoche (caso atípico)
    return minutosDelDia >= inicioMin && minutosDelDia < finMin;
  };

  // Combina festivos oficiales de Colombia con los festivos personalizados del usuario
  const esDiaEspecial = (fechaStr) => {
    return esDominicalOFestivo(fechaStr) || festivosPersonalizados.includes(fechaStr);
  };

  const aplicarPresetMesActual = () => {
    setRangoInicio(dayjs().startOf('month').format('YYYY-MM-DD'));
    setRangoFin(dayjs().endOf('month').format('YYYY-MM-DD'));
  };

  const aplicarPresetMesAnterior = () => {
    const mesAnterior = dayjs().subtract(1, 'month');
    setRangoInicio(mesAnterior.startOf('month').format('YYYY-MM-DD'));
    setRangoFin(mesAnterior.endOf('month').format('YYYY-MM-DD'));
  };

  const marcadoresFinales = useMemo(() => {
    let marcadores = {};
    Object.keys(turnosGuardados).forEach(fecha => {
      const datosTurno = turnosGuardados[fecha];
      let colorPunto = '#8E8E93';
      if (datosTurno.esDominicalOFestivo) colorPunto = '#AF52DE';
      else if (datosTurno.tieneExtra) colorPunto = '#FF3B30';
      marcadores[fecha] = {
        marked: true, 
        dotColor: colorPunto, 
      };
    });
    marcadores[fechaSeleccionada] = {
      ...marcadores[fechaSeleccionada], 
      selected: true,
      selectedColor: '#007AFF', 
    };
    return marcadores;
  }, [fechaSeleccionada, turnosGuardados]);

  // --- RESUMEN POR RANGO DE FECHAS (personalizable) ---
  const resumenRango = useMemo(() => {
    let totalMes = 0;
    let diurnasMes = 0;
    let nocturnasMes = 0;
    let diurnasDFMes = 0;
    let nocturnasDFMes = 0;
    let extraDiurnasMes = 0;
    let extraNocturnasMes = 0;
    let extraDiurnasDFMes = 0;
    let extraNocturnasDFMes = 0;
    let diasTrabajados = 0;
    let diasDominicalFestivo = 0;

    Object.keys(turnosGuardados).forEach(fecha => {
      // Verificamos si la fecha guardada cae dentro del rango seleccionado (comparación de strings ISO funciona directamente)
      if (fecha >= rangoInicio && fecha <= rangoFin) {
        const turno = turnosGuardados[fecha];
        totalMes += parseFloat(turno.total || 0);
        diurnasMes += parseFloat(turno.diurnas || 0);
        nocturnasMes += parseFloat(turno.nocturnas || 0);
        diurnasDFMes += parseFloat(turno.diurnasDF || 0);
        nocturnasDFMes += parseFloat(turno.nocturnasDF || 0);
        extraDiurnasMes += parseFloat(turno.extraDiurnas || 0);
        extraNocturnasMes += parseFloat(turno.extraNocturnas || 0);
        extraDiurnasDFMes += parseFloat(turno.extraDiurnasDF || 0);
        extraNocturnasDFMes += parseFloat(turno.extraNocturnasDF || 0);
        diasTrabajados++;
        if (turno.esDominicalOFestivo) diasDominicalFestivo++;
      }
    });

    return {
      dias: diasTrabajados,
      total: totalMes.toFixed(2),
      diurnas: diurnasMes.toFixed(2),
      nocturnas: nocturnasMes.toFixed(2),
      diurnasDF: diurnasDFMes.toFixed(2),
      nocturnasDF: nocturnasDFMes.toFixed(2),
      extraDiurnas: extraDiurnasMes.toFixed(2),
      extraNocturnas: extraNocturnasMes.toFixed(2),
      extraDiurnasDF: extraDiurnasDFMes.toFixed(2),
      extraNocturnasDF: extraNocturnasDFMes.toFixed(2),
      diasDominicalFestivo,
      horasDominicalFestivo: (diurnasDFMes + nocturnasDFMes + extraDiurnasDFMes + extraNocturnasDFMes).toFixed(2)
    };
  }, [rangoInicio, rangoFin, turnosGuardados]);

  const alTocarDia = (dia) => {
    const nuevaFecha = dia.dateString;
    setFechaSeleccionada(nuevaFecha);
    setMostrarModalCalendario(false);
    const turnoDeEseDia = turnosGuardados[nuevaFecha];
    if (turnoDeEseDia) {
      setResultado(turnoDeEseDia);
      setHoraEntrada(turnoDeEseDia.horaEntradaGuardada);
      setHoraSalida(turnoDeEseDia.horaSalidaGuardada);
    } else {
      setResultado(null);
      setHoraEntrada('');
      setHoraSalida('');
    }
  };

  const calcularHorasYGuardar = () => {
    if (!horaEntrada || !horaSalida) { Alert.alert("Datos incompletos", "Por favor selecciona ambas horas"); return; }

    const jornadaNumerica = parsearDecimal(jornadaLaboral);
    if (jornadaLaboral === '' || isNaN(jornadaNumerica)) {
      Alert.alert("Jornada inválida", "Ingresa un número válido de horas para la jornada base (ej: 8 u 8.5).");
      return;
    }
    if (jornadaNumerica < 0 || jornadaNumerica > 24) {
      Alert.alert("Jornada inválida", "La jornada base no puede ser negativa ni superar 24 horas.");
      return;
    }

    // IMPORTANTE: anclamos entrada/salida a la fecha REAL seleccionada en el calendario
    // (no a la fecha del sistema), para que cada minuto del turno se pueda ubicar
    // en su día calendario correcto, incluso si el turno cruza la medianoche.
    let entrada = dayjs(`${fechaSeleccionada} ${horaEntrada}`, 'YYYY-MM-DD HH:mm');
    let salida = dayjs(`${fechaSeleccionada} ${horaSalida}`, 'YYYY-MM-DD HH:mm');
    if (salida.isBefore(entrada) || salida.isSame(entrada)) { salida = salida.add(1, 'day'); }

    const totalMinutos = salida.diff(entrada, 'minute');
    const jornadaMinutos = jornadaNumerica * 60;

    // Cache local para no recalcular festivos del mismo día varias veces dentro del loop
    const cacheDF = {};
    const esDF = (fechaStr) => {
      if (cacheDF[fechaStr] === undefined) cacheDF[fechaStr] = esDiaEspecial(fechaStr);
      return cacheDF[fechaStr];
    };

    // 8 categorías estándar de nómina colombiana
    let minDiurnaOrd = 0;      // Ordinaria diurna
    let minNocturnaOrd = 0;    // Recargo nocturno (35%)
    let minDiurnaDF = 0;       // Ordinaria diurna dominical/festivo (75%)
    let minNocturnaDF = 0;     // Ordinaria nocturna dominical/festivo (110%)
    let minExtraDiurna = 0;    // Hora extra diurna (25%)
    let minExtraNocturna = 0;  // Hora extra nocturna (75%)
    let minExtraDiurnaDF = 0;  // Extra diurna dominical/festivo (100%)
    let minExtraNocturnaDF = 0;// Extra nocturna dominical/festivo (150%)

    for (let i = 0; i < totalMinutos; i++) {
      let minutoActual = entrada.add(i, 'minute');
      let horaDelReloj = minutoActual.hour();
      let isNight = esMinutoNocturno(horaDelReloj, minutoActual.minute());
      let isExtra = i >= jornadaMinutos;
      let isDF = esDF(minutoActual.format('YYYY-MM-DD'));

      if (isExtra) {
        if (isDF) { if (isNight) minExtraNocturnaDF++; else minExtraDiurnaDF++; }
        else { if (isNight) minExtraNocturna++; else minExtraDiurna++; }
      } else {
        if (isDF) { if (isNight) minNocturnaDF++; else minDiurnaDF++; }
        else { if (isNight) minNocturnaOrd++; else minDiurnaOrd++; }
      }
    }

    const huboExtras = (minExtraDiurna + minExtraNocturna + minExtraDiurnaDF + minExtraNocturnaDF) > 0;
    const huboDominicalFestivo = (minDiurnaDF + minNocturnaDF + minExtraDiurnaDF + minExtraNocturnaDF) > 0;

    const desgloseResultados = {
      total: (totalMinutos / 60).toFixed(2),
      diurnas: (minDiurnaOrd / 60).toFixed(2),
      nocturnas: (minNocturnaOrd / 60).toFixed(2),
      diurnasDF: (minDiurnaDF / 60).toFixed(2),
      nocturnasDF: (minNocturnaDF / 60).toFixed(2),
      extraDiurnas: (minExtraDiurna / 60).toFixed(2),
      extraNocturnas: (minExtraNocturna / 60).toFixed(2),
      extraDiurnasDF: (minExtraDiurnaDF / 60).toFixed(2),
      extraNocturnasDF: (minExtraNocturnaDF / 60).toFixed(2),
      horaEntradaGuardada: horaEntrada,
      horaSalidaGuardada: horaSalida,
      tieneExtra: huboExtras,
      esDominicalOFestivo: huboDominicalFestivo
    };

    setResultado(desgloseResultados);
    const nuevosTurnos = { ...turnosGuardados, [fechaSeleccionada]: desgloseResultados };
    setTurnosGuardados(nuevosTurnos);
    guardarTurnoEnMemoria(nuevosTurnos);
    setMostrarModalRegistro(false);
    Alert.alert("¡Guardado!", "El turno se ha registrado correctamente.");
  };

  const confirmarEliminarTurno = () => {
    Alert.alert("Eliminar Turno", "¿Estás seguro?", [
      { text: "Cancelar", style: "cancel" },
      { 
        text: "Sí, Eliminar", style: "destructive",
        onPress: () => {
          const nuevosTurnos = { ...turnosGuardados };
          delete nuevosTurnos[fechaSeleccionada];
          setTurnosGuardados(nuevosTurnos);
          guardarTurnoEnMemoria(nuevosTurnos);
          setResultado(null); setHoraEntrada(''); setHoraSalida('');
          setMostrarModalRegistro(false);
        }
      }
    ]);
  };

  const compartirResumen = async () => {
    const fechasDelRango = Object.keys(turnosGuardados)
      .filter(fecha => fecha >= rangoInicio && fecha <= rangoFin)
      .sort();

    if (fechasDelRango.length === 0) {
      Alert.alert("Sin turnos", "No hay turnos guardados en este rango de fechas.");
      return;
    }

    let texto = `📊 Resumen de Turnos\n`;
    texto += `📅 ${dayjs(rangoInicio).format('DD/MM/YYYY')} - ${dayjs(rangoFin).format('DD/MM/YYYY')}\n`;
    texto += `————————————————\n\n`;

    fechasDelRango.forEach(fecha => {
      const turno = turnosGuardados[fecha];
      const etiquetaFestivo = turno.esDominicalOFestivo ? ' 🎉' : '';
      texto += `${dayjs(fecha).format('dddd DD/MM')}${etiquetaFestivo}: ${turno.total} hrs\n`;
    });

    texto += `\n————————————————\n`;
    texto += `📌 Días registrados: ${resumenRango.dias}\n`;
    texto += `⏱ Total Acumulado: ${resumenRango.total} hrs\n\n`;
    texto += `🥑 Ord. Diurnas: ${resumenRango.diurnas}h\n`;
    texto += `🌙 Ord. Nocturnas: ${resumenRango.nocturnas}h\n`;
    texto += `🌶️ Ext. Diurnas: ${resumenRango.extraDiurnas}h\n`;
    texto += `🌌 Ext. Nocturnas: ${resumenRango.extraNocturnas}h\n`;

    if (resumenRango.diasDominicalFestivo > 0) {
      texto += `\n🎉 Domingos/Festivos trabajados: ${resumenRango.diasDominicalFestivo}\n`;
      texto += `Diurna DF: ${resumenRango.diurnasDF}h\n`;
      texto += `Nocturna DF: ${resumenRango.nocturnasDF}h\n`;
      if (parseFloat(resumenRango.extraDiurnasDF) > 0 || parseFloat(resumenRango.extraNocturnasDF) > 0) {
        texto += `Extra Diurna DF: ${resumenRango.extraDiurnasDF}h\n`;
        texto += `Extra Nocturna DF: ${resumenRango.extraNocturnasDF}h\n`;
      }
    }

    try {
      await Share.share({ message: texto });
    } catch (error) {
      console.error('Error al compartir:', error.message);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#f5f5f5" />
      <KeyboardAvoidingView behavior="padding" style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.titleRow}>
            <View style={styles.titleSpacer} />
            <Text style={styles.title}>Calculadora de Turnos</Text>
            <TouchableOpacity style={styles.titleSpacer} onPress={() => setMostrarConfiguracion(true)}>
              <Ionicons name="settings-outline" size={24} color="#555" />
            </TouchableOpacity>
          </View>

        <TouchableOpacity style={styles.dateSelectorCompact} onPress={() => setMostrarModalCalendario(true)} activeOpacity={0.8}>
          <Text style={styles.dateSelectorLabel}>Fecha</Text>
          <View style={styles.dateSelectorBadge}>
            <Text style={styles.dateSelectorBadgeText}>
              {dayjs(fechaSeleccionada).format('D MMM YYYY')}
            </Text>
          </View>
        </TouchableOpacity>

        <Modal
          visible={mostrarModalCalendario}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setMostrarModalCalendario(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Selecciona una fecha</Text>
                <TouchableOpacity onPress={() => setMostrarModalCalendario(false)}>
                  <Ionicons name="close" size={26} color="#333" />
                </TouchableOpacity>
              </View>
              <Calendar onDayPress={alTocarDia} markedDates={marcadoresFinales} theme={{ todayTextColor: '#007AFF', arrowColor: '#007AFF', selectedDotColor: '#ffffff' }} />
            </View>
          </View>
        </Modal>

        <Modal
          visible={mostrarConfiguracion}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setMostrarConfiguracion(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, styles.modalContentAlto]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Configuración</Text>
                <TouchableOpacity onPress={() => setMostrarConfiguracion(false)}>
                  <Ionicons name="close" size={26} color="#333" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.configSectionTitle}>Horario Nocturno</Text>
                <Text style={styles.configSectionHint}>
                  Define desde qué hora hasta qué hora se considera trabajo nocturno (recargo).
                </Text>
                <View style={styles.rangeRow}>
                  <TouchableOpacity style={styles.rangeSelector} onPress={() => setMostrarRelojInicioNocturno(true)}>
                    <Text style={styles.rangeLabel}>Desde</Text>
                    <Text style={styles.rangeValue}>{horaInicioNocturno}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.rangeSelector} onPress={() => setMostrarRelojFinNocturno(true)}>
                    <Text style={styles.rangeLabel}>Hasta</Text>
                    <Text style={styles.rangeValue}>{horaFinNocturno}</Text>
                  </TouchableOpacity>
                </View>

                {mostrarRelojInicioNocturno && (
                  <DateTimePicker value={convertirTextoAFecha(horaInicioNocturno)} mode="time" is24Hour={true} display="default" onChange={alCambiarHoraInicioNocturno} />
                )}
                {mostrarRelojFinNocturno && (
                  <DateTimePicker value={convertirTextoAFecha(horaFinNocturno)} mode="time" is24Hour={true} display="default" onChange={alCambiarHoraFinNocturno} />
                )}

                <View style={styles.divider} />

                <Text style={styles.configSectionTitle}>Festivos Personalizados</Text>
                <Text style={styles.configSectionHint}>
                  Agrega días adicionales (ej. festivos internos de tu empresa) que se calculen como festivo.
                </Text>

                {festivosPersonalizados.length === 0 && (
                  <Text style={styles.configEmptyText}>No has agregado festivos personalizados.</Text>
                )}

                {festivosPersonalizados.map((fechaStr) => (
                  <View key={fechaStr} style={styles.festivoRow}>
                    <Text style={styles.festivoRowText}>
                      {dayjs(fechaStr).format('dddd D [de] MMMM YYYY')}
                    </Text>
                    <TouchableOpacity onPress={() => eliminarFestivoPersonalizado(fechaStr)}>
                      <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                    </TouchableOpacity>
                  </View>
                ))}

                <TouchableOpacity style={styles.addFestivoButton} onPress={() => setMostrarSelectorFestivo(true)}>
                  <Ionicons name="add-circle-outline" size={20} color="#007AFF" />
                  <Text style={styles.addFestivoButtonText}>Agregar festivo</Text>
                </TouchableOpacity>

                {mostrarSelectorFestivo && (
                  <DateTimePicker value={new Date()} mode="date" display="default" onChange={alAgregarFestivoPersonalizado} />
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* --- TARJETA: RESUMEN POR RANGO DE FECHAS --- */}
        <View style={styles.monthCard}>
          <Text style={styles.monthTitle}>Resumen</Text>

          <View style={styles.presetRow}>
            <TouchableOpacity style={styles.presetButton} onPress={aplicarPresetMesActual}>
              <Text style={styles.presetButtonText}>Mes Actual</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.presetButton} onPress={aplicarPresetMesAnterior}>
              <Text style={styles.presetButtonText}>Mes Anterior</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.rangeRow}>
            <TouchableOpacity style={styles.rangeSelector} onPress={() => setMostrarSelectorInicio(true)}>
              <Text style={styles.rangeLabel}>Desde</Text>
              <Text style={styles.rangeValue}>{dayjs(rangoInicio).format('DD/MM/YYYY')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rangeSelector} onPress={() => setMostrarSelectorFin(true)}>
              <Text style={styles.rangeLabel}>Hasta</Text>
              <Text style={styles.rangeValue}>{dayjs(rangoFin).format('DD/MM/YYYY')}</Text>
            </TouchableOpacity>
          </View>

          {mostrarSelectorInicio && (
            <DateTimePicker value={dayjs(rangoInicio).toDate()} mode="date" display="default" onChange={alCambiarRangoInicio} />
          )}
          {mostrarSelectorFin && (
            <DateTimePicker value={dayjs(rangoFin).toDate()} mode="date" display="default" onChange={alCambiarRangoFin} />
          )}

          <Text style={styles.monthSubtitle}>Días registrados: {resumenRango.dias}</Text>
          <Text style={styles.monthTotalText}>⏱ Total Acumulado: {resumenRango.total} hrs</Text>
          
          <View style={styles.divider} />
          
          <View style={styles.row}>
            <Text style={styles.monthSubText}>🥑 Ord. Diurnas: {resumenRango.diurnas}h</Text>
            <Text style={styles.monthSubText}>🌙 Ord. Nocturnas: {resumenRango.nocturnas}h</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.monthSubText}>🌶️ Ext. Diurnas: {resumenRango.extraDiurnas}h</Text>
            <Text style={styles.monthSubText}>🌌 Ext. Nocturnas: {resumenRango.extraNocturnas}h</Text>
          </View>
          {resumenRango.diasDominicalFestivo > 0 && (
            <>
              <View style={styles.divider} />
              <Text style={styles.monthSubtitle}>🎉 Domingos/Festivos trabajados: {resumenRango.diasDominicalFestivo}</Text>
              <View style={styles.row}>
                <Text style={styles.monthSubText}>Diurna DF: {resumenRango.diurnasDF}h</Text>
                <Text style={styles.monthSubText}>Nocturna DF: {resumenRango.nocturnasDF}h</Text>
              </View>
              {(parseFloat(resumenRango.extraDiurnasDF) > 0 || parseFloat(resumenRango.extraNocturnasDF) > 0) && (
                <View style={styles.row}>
                  <Text style={styles.monthSubText}>Extra Diurna DF: {resumenRango.extraDiurnasDF}h</Text>
                  <Text style={styles.monthSubText}>Extra Nocturna DF: {resumenRango.extraNocturnasDF}h</Text>
                </View>
              )}
            </>
          )}

          <TouchableOpacity style={styles.shareButtonSolid} onPress={compartirResumen}>
            <Ionicons name="share-social-outline" size={18} color="#fff" />
            <Text style={styles.shareButtonSolidText}>Compartir Resumen</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.dateSelectorCompact} onPress={() => setMostrarModalRegistro(true)} activeOpacity={0.8}>
          <Text style={styles.dateSelectorLabel}>Horario del Turno</Text>
          <View style={styles.dateSelectorBadge}>
            <Text style={styles.dateSelectorBadgeText}>
              {horaEntrada && horaSalida ? `${horaEntrada} - ${horaSalida}` : "Toca para registrar"}
            </Text>
          </View>
        </TouchableOpacity>

        <Modal
          visible={mostrarModalRegistro}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setMostrarModalRegistro(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Registrar Turno</Text>
                <TouchableOpacity onPress={() => setMostrarModalRegistro(false)}>
                  <Ionicons name="close" size={26} color="#333" />
                </TouchableOpacity>
              </View>

              <Text style={styles.subtitle}>
                {dayjs(fechaSeleccionada).format('dddd D [de] MMMM YYYY')}
              </Text>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Hora de Entrada</Text>
                <TouchableOpacity style={styles.timeSelector} onPress={() => setMostrarRelojEntrada(true)}>
                  <Text style={[styles.timeText, !horaEntrada && styles.placeholderText]}>
                    {horaEntrada ? horaEntrada : "Toca para seleccionar..."}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Hora de Salida</Text>
                <TouchableOpacity style={styles.timeSelector} onPress={() => setMostrarRelojSalida(true)}>
                  <Text style={[styles.timeText, !horaSalida && styles.placeholderText]}>
                    {horaSalida ? horaSalida : "Toca para seleccionar..."}
                  </Text>
                </TouchableOpacity>
              </View>

              {mostrarRelojEntrada && (
                <DateTimePicker value={convertirTextoAFecha(horaEntrada)} mode="time" is24Hour={true} display="default" onChange={alCambiarEntrada} />
              )}

              {mostrarRelojSalida && (
                <DateTimePicker value={convertirTextoAFecha(horaSalida)} mode="time" is24Hour={true} display="default" onChange={alCambiarSalida} />
              )}

              <View style={styles.inputContainer}>
                <Text style={styles.label}>Jornada Base (Horas)</Text>
                <TextInput
                  style={[styles.timeSelector, styles.inputText]}
                  value={jornadaLaboral}
                  onChangeText={setJornadaLaboral}
                  keyboardType="numeric"
                  placeholder="Ej: 8"
                  placeholderTextColor="#999"
                />
              </View>

              <TouchableOpacity style={styles.button} onPress={calcularHorasYGuardar}>
                <Text style={styles.buttonText}>{resultado ? "Actualizar Turno" : "Calcular y Guardar"}</Text>
              </TouchableOpacity>

              {resultado && (
                <TouchableOpacity style={styles.deleteButton} onPress={confirmarEliminarTurno}>
                  <Text style={styles.deleteButtonText}>Borrar Turno</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Modal>

        {resultado && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Desglose del Día</Text>
            {resultado.esDominicalOFestivo && (
              <View style={styles.badgeDominical}>
                <Text style={styles.badgeDominicalText}>🎉 Incluye horas en Domingo/Festivo</Text>
              </View>
            )}
            <Text style={styles.totalText}>⏱ Total Día: {resultado.total} hrs</Text>
            <View style={styles.divider} />

            <Text style={styles.sectionLabel}>Horas Ordinarias</Text>
            <Text style={styles.resultText}>☀️ Diurna (0%): {resultado.diurnas} hrs</Text>
            <Text style={styles.resultText}>🌙 Nocturna (+35%): {resultado.nocturnas} hrs</Text>
            {parseFloat(resultado.diurnasDF) > 0 && (
              <Text style={styles.resultText}>🎉 Diurna Dominical/Festivo (+75%): {resultado.diurnasDF} hrs</Text>
            )}
            {parseFloat(resultado.nocturnasDF) > 0 && (
              <Text style={styles.resultText}>🌒 Nocturna Dominical/Festivo (+110%): {resultado.nocturnasDF} hrs</Text>
            )}

            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>Horas Extra</Text>
            <Text style={styles.resultText}>🔥 Extra Diurna (+25%): {resultado.extraDiurnas} hrs</Text>
            <Text style={styles.resultText}>🌌 Extra Nocturna (+75%): {resultado.extraNocturnas} hrs</Text>
            {parseFloat(resultado.extraDiurnasDF) > 0 && (
              <Text style={styles.resultText}>🎆 Extra Diurna Dominical/Festivo (+100%): {resultado.extraDiurnasDF} hrs</Text>
            )}
            {parseFloat(resultado.extraNocturnasDF) > 0 && (
              <Text style={styles.resultText}>🌠 Extra Nocturna Dominical/Festivo (+150%): {resultado.extraNocturnasDF} hrs</Text>
            )}
          </View>
        )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  scroll: { padding: 20, justifyContent: 'center', flexGrow: 1 },
  title: { fontSize: 28, fontWeight: 'bold', textAlign: 'center', color: '#333', flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  titleSpacer: { width: 24 },
  subtitle: { fontSize: 16, fontWeight: 'bold', textAlign: 'center', color: '#007AFF', marginBottom: 20 },
  calendarContainer: { backgroundColor: '#fff', borderRadius: 10, padding: 5, marginBottom: 20, elevation: 2 },

  dateSelectorCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 30,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 20,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  dateSelectorLabel: { fontSize: 17, color: '#333' },
  dateSelectorBadge: {
    backgroundColor: '#eee',
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  dateSelectorBadgeText: { fontSize: 16, fontWeight: 'bold', color: '#333' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 30 },
  modalContentAlto: { maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },

  configSectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 4 },
  configSectionHint: { fontSize: 13, color: '#888', marginBottom: 12 },
  configEmptyText: { fontSize: 14, color: '#999', fontStyle: 'italic', marginBottom: 10 },
  festivoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f7f7f7', borderRadius: 8, padding: 12, marginBottom: 8 },
  festivoRowText: { fontSize: 14, color: '#333', flex: 1, marginRight: 10, textTransform: 'capitalize' },
  addFestivoButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#007AFF', borderRadius: 10, paddingVertical: 12, marginTop: 5, marginBottom: 10, gap: 8 },
  addFestivoButtonText: { color: '#007AFF', fontWeight: 'bold', fontSize: 15 },
  
  // Estilos del Resumen Mensual
  monthCard: { backgroundColor: '#eef6ff', padding: 20, borderRadius: 10, borderWidth: 1, borderColor: '#d0e3ff', marginBottom: 25, elevation: 2 },
  monthTitle: { fontSize: 18, fontWeight: 'bold', color: '#0056b3', textAlign: 'center', textTransform: 'capitalize' },
  monthSubtitle: { fontSize: 14, color: '#555', textAlign: 'center', marginBottom: 8 },
  monthTotalText: { fontSize: 18, fontWeight: 'bold', color: '#007AFF', textAlign: 'center', marginBottom: 5 },
  monthSubText: { fontSize: 14, color: '#444', flex: 1, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 3 },

  // Estilos del selector de rango
  presetRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 10, gap: 10 },
  presetButton: { backgroundColor: '#d0e3ff', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20 },
  presetButtonText: { color: '#0056b3', fontWeight: '600', fontSize: 13 },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, gap: 10 },
  rangeSelector: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d0e3ff', borderRadius: 8, padding: 10, alignItems: 'center' },
  rangeLabel: { fontSize: 12, color: '#888' },
  rangeValue: { fontSize: 15, fontWeight: 'bold', color: '#0056b3', marginTop: 2 },

  inputContainer: { marginBottom: 15 },
  label: { fontSize: 16, marginBottom: 5, color: '#666', fontWeight: '500' },
  timeSelector: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', padding: 15, borderRadius: 10, justifyContent: 'center' },
  inputText: { fontSize: 18, color: '#333' },
  timeText: { fontSize: 18, color: '#333' },
  placeholderText: { color: '#999' },
  button: { backgroundColor: '#007AFF', padding: 15, borderRadius: 10, marginTop: 10 },
  buttonText: { color: '#fff', textAlign: 'center', fontSize: 18, fontWeight: 'bold' },
  deleteButton: { backgroundColor: 'transparent', padding: 15, borderRadius: 10, marginTop: 10, borderWidth: 1, borderColor: '#FF3B30' },
  deleteButtonText: { color: '#FF3B30', textAlign: 'center', fontSize: 18, fontWeight: 'bold' },
  resultCard: { marginTop: 30, backgroundColor: '#fff', padding: 20, borderRadius: 10, borderWidth: 1, borderColor: '#e0e0e0', elevation: 2 },
  resultTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10, color: '#333', textAlign: 'center' },
  shareButtonSolid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#007AFF', borderRadius: 10, paddingVertical: 12, marginTop: 15, gap: 6 },
  shareButtonSolidText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  badgeDominical: { backgroundColor: '#f3e6fb', borderColor: '#AF52DE', borderWidth: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, marginBottom: 10, alignSelf: 'center' },
  badgeDominicalText: { color: '#AF52DE', fontWeight: 'bold', fontSize: 13 },
  sectionLabel: { fontSize: 13, fontWeight: 'bold', color: '#999', textTransform: 'uppercase', marginTop: 6, marginBottom: 4 },
  totalText: { fontSize: 18, fontWeight: 'bold', color: '#007AFF', marginBottom: 10, textAlign: 'center' },
  divider: { height: 1, backgroundColor: '#dcdcdc', marginVertical: 10 },
  resultText: { fontSize: 16, marginVertical: 3, color: '#444' }
});