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

// Porcentajes de recargo colombianos por defecto sobre la hora ordinaria. El usuario
// puede ajustarlos en la pantalla de Ajustes (ej. cuando cambie la ley) sin tocar código.
// Vigentes desde el 1 de julio de 2026 (Ley 2466 de 2025, art. 14, que modifica el
// art. 179 CST): el recargo dominical/festivo sube a 100% desde julio de 2027.
const DEFAULT_PORCENTAJES_RECARGO = {
  nocturno: 35,
  dominicalFestivo: 90,
  extraDiurna: 25,
  extraNocturna: 75,
};

// Redondea un porcentaje para mostrarlo sin decimales innecesarios (ej: 35, 32.5)
const formatearPorcentaje = (valor) => {
  const redondeado = Math.round(valor * 10) / 10;
  return Number.isInteger(redondeado) ? redondeado : redondeado.toFixed(1);
};

const formatearDinero = (numero) => {
  if (isNaN(numero)) return '$0';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(numero);
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

  // --- Navegación por pestañas (Turnos / Recargos) ---
  const [pantallaActiva, setPantallaActiva] = useState('turnos');

  // --- Rango de fechas para el Valor de Recargos (filtro independiente del resumen) ---
  const [rangoInicioValor, setRangoInicioValor] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [rangoFinValor, setRangoFinValor] = useState(dayjs().endOf('month').format('YYYY-MM-DD'));
  const [mostrarSelectorInicioValor, setMostrarSelectorInicioValor] = useState(false);
  const [mostrarSelectorFinValor, setMostrarSelectorFinValor] = useState(false);
  const [valorHoraOrdinaria, setValorHoraOrdinaria] = useState('');

  // --- Configuración (horario nocturno editable y festivos personalizados) ---
  const [mostrarConfiguracion, setMostrarConfiguracion] = useState(false);
  const [horaInicioNocturno, setHoraInicioNocturno] = useState('19:00');
  const [horaFinNocturno, setHoraFinNocturno] = useState('06:00');
  const [festivosPersonalizados, setFestivosPersonalizados] = useState([]);
  const [mostrarRelojInicioNocturno, setMostrarRelojInicioNocturno] = useState(false);
  const [mostrarRelojFinNocturno, setMostrarRelojFinNocturno] = useState(false);
  const [mostrarSelectorFestivo, setMostrarSelectorFestivo] = useState(false);
  const [topeExtraSemanal, setTopeExtraSemanal] = useState('12');
  const [configCargada, setConfigCargada] = useState(false);

  // --- Porcentajes de recargo (editables en Ajustes, ver DEFAULT_PORCENTAJES_RECARGO) ---
  const [pctNocturno, setPctNocturno] = useState(String(DEFAULT_PORCENTAJES_RECARGO.nocturno));
  const [pctDominicalFestivo, setPctDominicalFestivo] = useState(String(DEFAULT_PORCENTAJES_RECARGO.dominicalFestivo));
  const [pctExtraDiurna, setPctExtraDiurna] = useState(String(DEFAULT_PORCENTAJES_RECARGO.extraDiurna));
  const [pctExtraNocturna, setPctExtraNocturna] = useState(String(DEFAULT_PORCENTAJES_RECARGO.extraNocturna));

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
        if (config.topeExtraSemanal) setTopeExtraSemanal(config.topeExtraSemanal);
        if (config.valorHoraOrdinaria) setValorHoraOrdinaria(config.valorHoraOrdinaria);
        if (config.pctNocturno) setPctNocturno(config.pctNocturno);
        if (config.pctDominicalFestivo) setPctDominicalFestivo(config.pctDominicalFestivo);
        if (config.pctExtraDiurna) setPctExtraDiurna(config.pctExtraDiurna);
        if (config.pctExtraNocturna) setPctExtraNocturna(config.pctExtraNocturna);
      }
    } catch (error) {
      console.error("Error al cargar configuración:", error);
    } finally {
      setConfigCargada(true);
    }
  };

  const guardarConfiguracion = async (nuevaConfig) => {
    try {
      await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(nuevaConfig));
    } catch (error) {
      Alert.alert("Error", "No se pudo guardar la configuración.");
    }
  };

  // Autoguarda la configuración cada vez que cambia alguno de estos valores.
  // Se ignora el primer render (antes de que cargarConfiguracion termine) para
  // no sobrescribir lo guardado con los valores por defecto del estado inicial.
  useEffect(() => {
    if (!configCargada) return;
    guardarConfiguracion({
      horaInicioNocturno, horaFinNocturno, festivosPersonalizados, topeExtraSemanal, valorHoraOrdinaria,
      pctNocturno, pctDominicalFestivo, pctExtraDiurna, pctExtraNocturna,
    });
  }, [horaInicioNocturno, horaFinNocturno, festivosPersonalizados, topeExtraSemanal, valorHoraOrdinaria, configCargada,
      pctNocturno, pctDominicalFestivo, pctExtraDiurna, pctExtraNocturna]);

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

  const alCambiarRangoInicioValor = (event, fecha) => {
    setMostrarSelectorInicioValor(false);
    if (fecha) {
      const nuevoInicio = dayjs(fecha).format('YYYY-MM-DD');
      setRangoInicioValor(nuevoInicio);
      if (dayjs(nuevoInicio).isAfter(dayjs(rangoFinValor))) setRangoFinValor(nuevoInicio);
    }
  };

  const alCambiarRangoFinValor = (event, fecha) => {
    setMostrarSelectorFinValor(false);
    if (fecha) {
      const nuevoFin = dayjs(fecha).format('YYYY-MM-DD');
      setRangoFinValor(nuevoFin);
      if (dayjs(nuevoFin).isBefore(dayjs(rangoInicioValor))) setRangoInicioValor(nuevoFin);
    }
  };

  const alCambiarHoraInicioNocturno = (event, fecha) => {
    setMostrarRelojInicioNocturno(false);
    if (fecha) {
      setHoraInicioNocturno(dayjs(fecha).format('HH:mm'));
    }
  };

  const alCambiarHoraFinNocturno = (event, fecha) => {
    setMostrarRelojFinNocturno(false);
    if (fecha) {
      setHoraFinNocturno(dayjs(fecha).format('HH:mm'));
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
    }
  };

  const eliminarFestivoPersonalizado = (fechaStr) => {
    const nuevaLista = festivosPersonalizados.filter(f => f !== fechaStr);
    setFestivosPersonalizados(nuevaLista);
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

  const aplicarPresetMesActualValor = () => {
    setRangoInicioValor(dayjs().startOf('month').format('YYYY-MM-DD'));
    setRangoFinValor(dayjs().endOf('month').format('YYYY-MM-DD'));
  };

  const aplicarPresetMesAnteriorValor = () => {
    const mesAnterior = dayjs().subtract(1, 'month');
    setRangoInicioValor(mesAnterior.startOf('month').format('YYYY-MM-DD'));
    setRangoFinValor(mesAnterior.endOf('month').format('YYYY-MM-DD'));
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

  // --- Multiplicadores derivados de los porcentajes configurados en Ajustes ---
  const multiplicadoresRecargo = useMemo(() => {
    const nocturno = parsearDecimal(pctNocturno);
    const df = parsearDecimal(pctDominicalFestivo);
    const extraD = parsearDecimal(pctExtraDiurna);
    const extraN = parsearDecimal(pctExtraNocturna);
    const n = isNaN(nocturno) ? 0 : nocturno;
    const d = isNaN(df) ? 0 : df;
    const ed = isNaN(extraD) ? 0 : extraD;
    const en = isNaN(extraN) ? 0 : extraN;
    return {
      diurnas: 1,
      nocturnas: 1 + n / 100,
      diurnasDF: 1 + d / 100,
      nocturnasDF: 1 + n / 100 + d / 100,
      extraDiurnas: 1 + ed / 100,
      extraNocturnas: 1 + en / 100,
      extraDiurnasDF: 1 + ed / 100 + d / 100,
      extraNocturnasDF: 1 + en / 100 + d / 100,
    };
  }, [pctNocturno, pctDominicalFestivo, pctExtraDiurna, pctExtraNocturna]);

  // Texto "+35%" a partir del multiplicador de una categoría (usa los valores de Ajustes)
  const pctTexto = (categoria) => `+${formatearPorcentaje((multiplicadoresRecargo[categoria] - 1) * 100)}%`;

  // --- RESUMEN DE VALOR EN DINERO DE LOS RECARGOS (filtro y rango propios) ---
  const resumenValorRecargos = useMemo(() => {
    const valorHora = parsearDecimal(valorHoraOrdinaria);
    const valorHoraValido = !isNaN(valorHora) && valorHora > 0;

    const horas = { diurnas: 0, nocturnas: 0, diurnasDF: 0, nocturnasDF: 0, extraDiurnas: 0, extraNocturnas: 0, extraDiurnasDF: 0, extraNocturnasDF: 0 };

    Object.keys(turnosGuardados).forEach(fecha => {
      if (fecha >= rangoInicioValor && fecha <= rangoFinValor) {
        const turno = turnosGuardados[fecha];
        Object.keys(horas).forEach(categoria => {
          horas[categoria] += parseFloat(turno[categoria] || 0);
        });
      }
    });

    const dinero = {};
    let total = 0;
    Object.keys(horas).forEach(categoria => {
      const valorCategoria = valorHoraValido ? horas[categoria] * valorHora * multiplicadoresRecargo[categoria] : 0;
      dinero[categoria] = valorCategoria;
      total += valorCategoria;
    });

    return { valorHoraValido, horas, dinero, total };
  }, [turnosGuardados, rangoInicioValor, rangoFinValor, valorHoraOrdinaria, multiplicadoresRecargo]);

  // --- HORAS EXTRA DE LA SEMANA (lunes a domingo) que contiene la fecha seleccionada ---
  const resumenSemanaExtra = useMemo(() => {
    const inicioSemana = dayjs(fechaSeleccionada).startOf('week').format('YYYY-MM-DD');
    const finSemana = dayjs(fechaSeleccionada).endOf('week').format('YYYY-MM-DD');

    let horasExtra = 0;
    Object.keys(turnosGuardados).forEach(fecha => {
      if (fecha >= inicioSemana && fecha <= finSemana) {
        const turno = turnosGuardados[fecha];
        horasExtra += parseFloat(turno.extraDiurnas || 0);
        horasExtra += parseFloat(turno.extraNocturnas || 0);
        horasExtra += parseFloat(turno.extraDiurnasDF || 0);
        horasExtra += parseFloat(turno.extraNocturnasDF || 0);
      }
    });

    const tope = parsearDecimal(topeExtraSemanal) > 0 ? parsearDecimal(topeExtraSemanal) : 12;
    const porcentaje = Math.min((horasExtra / tope) * 100, 100);

    return {
      inicioSemana,
      finSemana,
      horasExtra: horasExtra.toFixed(2),
      tope,
      porcentaje,
      excedido: horasExtra > tope,
    };
  }, [fechaSeleccionada, turnosGuardados, topeExtraSemanal]);

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
    let minDiurnaDF = 0;       // Ordinaria diurna dominical/festivo (90%)
    let minNocturnaDF = 0;     // Ordinaria nocturna dominical/festivo (125%)
    let minExtraDiurna = 0;    // Hora extra diurna (25%)
    let minExtraNocturna = 0;  // Hora extra nocturna (75%)
    let minExtraDiurnaDF = 0;  // Extra diurna dominical/festivo (115%)
    let minExtraNocturnaDF = 0;// Extra nocturna dominical/festivo (165%)

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

  const compartirValorRecargos = async () => {
    if (!resumenValorRecargos.valorHoraValido) {
      Alert.alert("Falta el valor de la hora", "Ingresa el valor de la hora ordinaria para calcular el dinero.");
      return;
    }

    let texto = `💰 Valor de Recargos\n`;
    texto += `📅 ${dayjs(rangoInicioValor).format('DD/MM/YYYY')} - ${dayjs(rangoFinValor).format('DD/MM/YYYY')}\n`;
    texto += `Hora ordinaria: ${formatearDinero(parsearDecimal(valorHoraOrdinaria))}\n`;
    texto += `————————————————\n\n`;

    texto += `☀️ Diurna (0%): ${resumenValorRecargos.horas.diurnas.toFixed(2)}h → ${formatearDinero(resumenValorRecargos.dinero.diurnas)}\n`;
    texto += `🌙 Nocturna (${pctTexto('nocturnas')}): ${resumenValorRecargos.horas.nocturnas.toFixed(2)}h → ${formatearDinero(resumenValorRecargos.dinero.nocturnas)}\n`;
    texto += `🔥 Extra Diurna (${pctTexto('extraDiurnas')}): ${resumenValorRecargos.horas.extraDiurnas.toFixed(2)}h → ${formatearDinero(resumenValorRecargos.dinero.extraDiurnas)}\n`;
    texto += `🌌 Extra Nocturna (${pctTexto('extraNocturnas')}): ${resumenValorRecargos.horas.extraNocturnas.toFixed(2)}h → ${formatearDinero(resumenValorRecargos.dinero.extraNocturnas)}\n`;

    if (resumenValorRecargos.horas.diurnasDF > 0 || resumenValorRecargos.horas.nocturnasDF > 0 ||
        resumenValorRecargos.horas.extraDiurnasDF > 0 || resumenValorRecargos.horas.extraNocturnasDF > 0) {
      texto += `\n🎉 Dominical/Festivo:\n`;
      if (resumenValorRecargos.horas.diurnasDF > 0) texto += `Diurna DF (${pctTexto('diurnasDF')}): ${resumenValorRecargos.horas.diurnasDF.toFixed(2)}h → ${formatearDinero(resumenValorRecargos.dinero.diurnasDF)}\n`;
      if (resumenValorRecargos.horas.nocturnasDF > 0) texto += `Nocturna DF (${pctTexto('nocturnasDF')}): ${resumenValorRecargos.horas.nocturnasDF.toFixed(2)}h → ${formatearDinero(resumenValorRecargos.dinero.nocturnasDF)}\n`;
      if (resumenValorRecargos.horas.extraDiurnasDF > 0) texto += `Extra Diurna DF (${pctTexto('extraDiurnasDF')}): ${resumenValorRecargos.horas.extraDiurnasDF.toFixed(2)}h → ${formatearDinero(resumenValorRecargos.dinero.extraDiurnasDF)}\n`;
      if (resumenValorRecargos.horas.extraNocturnasDF > 0) texto += `Extra Nocturna DF (${pctTexto('extraNocturnasDF')}): ${resumenValorRecargos.horas.extraNocturnasDF.toFixed(2)}h → ${formatearDinero(resumenValorRecargos.dinero.extraNocturnasDF)}\n`;
    }

    texto += `\n————————————————\n`;
    texto += `💵 TOTAL: ${formatearDinero(resumenValorRecargos.total)}\n`;

    try {
      await Share.share({ message: texto });
    } catch (error) {
      console.error('Error al compartir:', error.message);
    }
  };

  // Determina si el rango de fechas actual coincide con "Mes Actual" o "Mes Anterior",
  // para resaltar el botón correspondiente. Si el usuario elige fechas manualmente
  // que no calzan con ninguno de los dos, ningún botón queda resaltado.
  const inicioMesActual = dayjs().startOf('month').format('YYYY-MM-DD');
  const finMesActual = dayjs().endOf('month').format('YYYY-MM-DD');
  const mesAnteriorRef = dayjs().subtract(1, 'month');
  const inicioMesAnterior = mesAnteriorRef.startOf('month').format('YYYY-MM-DD');
  const finMesAnterior = mesAnteriorRef.endOf('month').format('YYYY-MM-DD');

  const esMesActualResumen = rangoInicio === inicioMesActual && rangoFin === finMesActual;
  const esMesAnteriorResumen = rangoInicio === inicioMesAnterior && rangoFin === finMesAnterior;

  const esMesActualValor = rangoInicioValor === inicioMesActual && rangoFinValor === finMesActual;
  const esMesAnteriorValor = rangoInicioValor === inicioMesAnterior && rangoFinValor === finMesAnterior;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#f5f5f5" />
      <KeyboardAvoidingView behavior="padding" style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
        {pantallaActiva === 'turnos' && (
        <>
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

        <View style={styles.progresoCard}>
          <View style={styles.progresoHeader}>
            <Text style={styles.progresoLabel}>
              Extras esta semana ({dayjs(resumenSemanaExtra.inicioSemana).format('D MMM')} - {dayjs(resumenSemanaExtra.finSemana).format('D MMM')})
            </Text>
            <Text style={[styles.progresoValor, resumenSemanaExtra.excedido && styles.progresoValorExcedido]}>
              {resumenSemanaExtra.horasExtra} / {resumenSemanaExtra.tope} hrs
            </Text>
          </View>
          <View style={styles.progresoBarraFondo}>
            <View
              style={[
                styles.progresoBarraRelleno,
                { width: `${resumenSemanaExtra.porcentaje}%` },
                resumenSemanaExtra.excedido && styles.progresoBarraRellenoExcedido,
              ]}
            />
          </View>
          {resumenSemanaExtra.excedido && (
            <Text style={styles.progresoAlerta}>⚠️ Superaste el tope semanal de horas extra</Text>
          )}
        </View>

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

                <View style={styles.divider} />

                <Text style={styles.configSectionTitle}>Porcentajes de Recargo</Text>
                <Text style={styles.configSectionHint}>
                  Ajusta estos porcentajes cuando cambie la ley, sin necesidad de actualizar la app.
                  Los recargos dominical/festivo y nocturno se suman cuando coinciden.
                </Text>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Recargo Nocturno (%)</Text>
                  <TextInput
                    style={[styles.timeSelector, styles.inputText]}
                    value={pctNocturno}
                    onChangeText={setPctNocturno}
                    keyboardType="numeric"
                    placeholder="Ej: 35"
                    placeholderTextColor="#999"
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Recargo Dominical/Festivo (%)</Text>
                  <TextInput
                    style={[styles.timeSelector, styles.inputText]}
                    value={pctDominicalFestivo}
                    onChangeText={setPctDominicalFestivo}
                    keyboardType="numeric"
                    placeholder="Ej: 90"
                    placeholderTextColor="#999"
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Hora Extra Diurna (%)</Text>
                  <TextInput
                    style={[styles.timeSelector, styles.inputText]}
                    value={pctExtraDiurna}
                    onChangeText={setPctExtraDiurna}
                    keyboardType="numeric"
                    placeholder="Ej: 25"
                    placeholderTextColor="#999"
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>Hora Extra Nocturna (%)</Text>
                  <TextInput
                    style={[styles.timeSelector, styles.inputText]}
                    value={pctExtraNocturna}
                    onChangeText={setPctExtraNocturna}
                    keyboardType="numeric"
                    placeholder="Ej: 75"
                    placeholderTextColor="#999"
                  />
                </View>

                <TouchableOpacity
                  style={styles.addFestivoButton}
                  onPress={() => {
                    setPctNocturno(String(DEFAULT_PORCENTAJES_RECARGO.nocturno));
                    setPctDominicalFestivo(String(DEFAULT_PORCENTAJES_RECARGO.dominicalFestivo));
                    setPctExtraDiurna(String(DEFAULT_PORCENTAJES_RECARGO.extraDiurna));
                    setPctExtraNocturna(String(DEFAULT_PORCENTAJES_RECARGO.extraNocturna));
                  }}
                >
                  <Ionicons name="refresh-outline" size={20} color="#007AFF" />
                  <Text style={styles.addFestivoButtonText}>Restablecer valores por defecto</Text>
                </TouchableOpacity>

                <View style={styles.divider} />

                <Text style={styles.configSectionTitle}>Tope de Horas Extra Semanal</Text>
                <Text style={styles.configSectionHint}>
                  Límite semanal de horas extra usado para la barra de progreso (por defecto 12 hrs).
                </Text>
                <TextInput
                  style={[styles.timeSelector, styles.inputText]}
                  value={topeExtraSemanal}
                  onChangeText={setTopeExtraSemanal}
                  keyboardType="numeric"
                  placeholder="Ej: 12"
                  placeholderTextColor="#999"
                />
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* --- TARJETA: RESUMEN POR RANGO DE FECHAS --- */}
        <View style={styles.monthCard}>
          <Text style={styles.monthTitle}>Resumen</Text>

          <View style={styles.presetRow}>
            <TouchableOpacity style={[styles.presetButton, esMesActualResumen && styles.presetButtonActivo]} onPress={aplicarPresetMesActual}>
              <Text style={[styles.presetButtonText, esMesActualResumen && styles.presetButtonTextActivo]}>Mes Actual</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.presetButton, esMesAnteriorResumen && styles.presetButtonActivo]} onPress={aplicarPresetMesAnterior}>
              <Text style={[styles.presetButtonText, esMesAnteriorResumen && styles.presetButtonTextActivo]}>Mes Anterior</Text>
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
            <Text style={styles.resultText}>🌙 Nocturna ({pctTexto('nocturnas')}): {resultado.nocturnas} hrs</Text>
            {parseFloat(resultado.diurnasDF) > 0 && (
              <Text style={styles.resultText}>🎉 Diurna Dominical/Festivo ({pctTexto('diurnasDF')}): {resultado.diurnasDF} hrs</Text>
            )}
            {parseFloat(resultado.nocturnasDF) > 0 && (
              <Text style={styles.resultText}>🌒 Nocturna Dominical/Festivo ({pctTexto('nocturnasDF')}): {resultado.nocturnasDF} hrs</Text>
            )}

            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>Horas Extra</Text>
            <Text style={styles.resultText}>🔥 Extra Diurna ({pctTexto('extraDiurnas')}): {resultado.extraDiurnas} hrs</Text>
            <Text style={styles.resultText}>🌌 Extra Nocturna ({pctTexto('extraNocturnas')}): {resultado.extraNocturnas} hrs</Text>
            {parseFloat(resultado.extraDiurnasDF) > 0 && (
              <Text style={styles.resultText}>🎆 Extra Diurna Dominical/Festivo ({pctTexto('extraDiurnasDF')}): {resultado.extraDiurnasDF} hrs</Text>
            )}
            {parseFloat(resultado.extraNocturnasDF) > 0 && (
              <Text style={styles.resultText}>🌠 Extra Nocturna Dominical/Festivo ({pctTexto('extraNocturnasDF')}): {resultado.extraNocturnasDF} hrs</Text>
            )}
          </View>
        )}
        </>
        )}

        {pantallaActiva === 'recargos' && (
        <>
          <View style={styles.titleRow}>
            <View style={styles.titleSpacer} />
            <Text style={styles.title}>Valor de Recargos</Text>
            <View style={styles.titleSpacer} />
          </View>

          <View style={styles.progresoCard}>
            <Text style={styles.label}>Valor de la Hora Ordinaria</Text>
            <TextInput
              style={[styles.timeSelector, styles.inputText]}
              value={valorHoraOrdinaria}
              onChangeText={setValorHoraOrdinaria}
              keyboardType="numeric"
              placeholder="Ej: 6500"
              placeholderTextColor="#999"
            />
            {!resumenValorRecargos.valorHoraValido && (
              <Text style={styles.configEmptyText}>Ingresa el valor de la hora para ver el cálculo en dinero.</Text>
            )}
          </View>

          <View style={styles.monthCard}>
            <Text style={styles.monthTitle}>Filtro de Fechas</Text>

            <View style={styles.presetRow}>
              <TouchableOpacity style={[styles.presetButton, esMesActualValor && styles.presetButtonActivo]} onPress={aplicarPresetMesActualValor}>
                <Text style={[styles.presetButtonText, esMesActualValor && styles.presetButtonTextActivo]}>Mes Actual</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.presetButton, esMesAnteriorValor && styles.presetButtonActivo]} onPress={aplicarPresetMesAnteriorValor}>
                <Text style={[styles.presetButtonText, esMesAnteriorValor && styles.presetButtonTextActivo]}>Mes Anterior</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.rangeRow}>
              <TouchableOpacity style={styles.rangeSelector} onPress={() => setMostrarSelectorInicioValor(true)}>
                <Text style={styles.rangeLabel}>Desde</Text>
                <Text style={styles.rangeValue}>{dayjs(rangoInicioValor).format('DD/MM/YYYY')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.rangeSelector} onPress={() => setMostrarSelectorFinValor(true)}>
                <Text style={styles.rangeLabel}>Hasta</Text>
                <Text style={styles.rangeValue}>{dayjs(rangoFinValor).format('DD/MM/YYYY')}</Text>
              </TouchableOpacity>
            </View>

            {mostrarSelectorInicioValor && (
              <DateTimePicker value={dayjs(rangoInicioValor).toDate()} mode="date" display="default" onChange={alCambiarRangoInicioValor} />
            )}
            {mostrarSelectorFinValor && (
              <DateTimePicker value={dayjs(rangoFinValor).toDate()} mode="date" display="default" onChange={alCambiarRangoFinValor} />
            )}
          </View>

          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Desglose en Dinero</Text>

            <View style={styles.dineroRow}>
              <Text style={styles.dineroCategoria}>☀️ Diurna (0%) · {resumenValorRecargos.horas.diurnas.toFixed(2)}h</Text>
              <Text style={styles.dineroValor}>{formatearDinero(resumenValorRecargos.dinero.diurnas)}</Text>
            </View>
            <View style={styles.dineroRow}>
              <Text style={styles.dineroCategoria}>🌙 Nocturna ({pctTexto('nocturnas')}) · {resumenValorRecargos.horas.nocturnas.toFixed(2)}h</Text>
              <Text style={styles.dineroValor}>{formatearDinero(resumenValorRecargos.dinero.nocturnas)}</Text>
            </View>
            <View style={styles.dineroRow}>
              <Text style={styles.dineroCategoria}>🔥 Extra Diurna ({pctTexto('extraDiurnas')}) · {resumenValorRecargos.horas.extraDiurnas.toFixed(2)}h</Text>
              <Text style={styles.dineroValor}>{formatearDinero(resumenValorRecargos.dinero.extraDiurnas)}</Text>
            </View>
            <View style={styles.dineroRow}>
              <Text style={styles.dineroCategoria}>🌌 Extra Nocturna ({pctTexto('extraNocturnas')}) · {resumenValorRecargos.horas.extraNocturnas.toFixed(2)}h</Text>
              <Text style={styles.dineroValor}>{formatearDinero(resumenValorRecargos.dinero.extraNocturnas)}</Text>
            </View>

            {(resumenValorRecargos.horas.diurnasDF > 0 || resumenValorRecargos.horas.nocturnasDF > 0 ||
              resumenValorRecargos.horas.extraDiurnasDF > 0 || resumenValorRecargos.horas.extraNocturnasDF > 0) && (
              <>
                <View style={styles.divider} />
                <Text style={styles.monthSubtitle}>🎉 Dominical/Festivo</Text>
                {resumenValorRecargos.horas.diurnasDF > 0 && (
                  <View style={styles.dineroRow}>
                    <Text style={styles.dineroCategoria}>Diurna DF ({pctTexto('diurnasDF')}) · {resumenValorRecargos.horas.diurnasDF.toFixed(2)}h</Text>
                    <Text style={styles.dineroValor}>{formatearDinero(resumenValorRecargos.dinero.diurnasDF)}</Text>
                  </View>
                )}
                {resumenValorRecargos.horas.nocturnasDF > 0 && (
                  <View style={styles.dineroRow}>
                    <Text style={styles.dineroCategoria}>Nocturna DF ({pctTexto('nocturnasDF')}) · {resumenValorRecargos.horas.nocturnasDF.toFixed(2)}h</Text>
                    <Text style={styles.dineroValor}>{formatearDinero(resumenValorRecargos.dinero.nocturnasDF)}</Text>
                  </View>
                )}
                {resumenValorRecargos.horas.extraDiurnasDF > 0 && (
                  <View style={styles.dineroRow}>
                    <Text style={styles.dineroCategoria}>Extra Diurna DF ({pctTexto('extraDiurnasDF')}) · {resumenValorRecargos.horas.extraDiurnasDF.toFixed(2)}h</Text>
                    <Text style={styles.dineroValor}>{formatearDinero(resumenValorRecargos.dinero.extraDiurnasDF)}</Text>
                  </View>
                )}
                {resumenValorRecargos.horas.extraNocturnasDF > 0 && (
                  <View style={styles.dineroRow}>
                    <Text style={styles.dineroCategoria}>Extra Nocturna DF ({pctTexto('extraNocturnasDF')}) · {resumenValorRecargos.horas.extraNocturnasDF.toFixed(2)}h</Text>
                    <Text style={styles.dineroValor}>{formatearDinero(resumenValorRecargos.dinero.extraNocturnasDF)}</Text>
                  </View>
                )}
              </>
            )}

            <View style={styles.divider} />

            <View style={styles.dineroTotalRow}>
              <Text style={styles.dineroTotalLabel}>TOTAL</Text>
              <Text style={styles.dineroTotalValor}>{formatearDinero(resumenValorRecargos.total)}</Text>
            </View>

            <TouchableOpacity style={styles.shareButtonSolid} onPress={compartirValorRecargos}>
              <Ionicons name="share-social-outline" size={18} color="#fff" />
              <Text style={styles.shareButtonSolidText}>Compartir Valor de Recargos</Text>
            </TouchableOpacity>
          </View>
        </>
        )}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tabItem} onPress={() => setPantallaActiva('turnos')} activeOpacity={0.7}>
          <Ionicons name="time-outline" size={24} color={pantallaActiva === 'turnos' ? '#007AFF' : '#999'} />
          <Text style={[styles.tabLabel, pantallaActiva === 'turnos' && styles.tabLabelActivo]}>Turnos</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => setPantallaActiva('recargos')} activeOpacity={0.7}>
          <Ionicons name="cash-outline" size={24} color={pantallaActiva === 'recargos' ? '#007AFF' : '#999'} />
          <Text style={[styles.tabLabel, pantallaActiva === 'recargos' && styles.tabLabelActivo]}>Recargos</Text>
        </TouchableOpacity>
      </View>
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

  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 8 : 12,
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabLabel: { fontSize: 12, color: '#999' },
  tabLabelActivo: { color: '#007AFF', fontWeight: 'bold' },

  progresoCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  progresoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progresoLabel: { fontSize: 13, color: '#666', flex: 1, marginRight: 8 },
  progresoValor: { fontSize: 14, fontWeight: 'bold', color: '#007AFF' },
  progresoValorExcedido: { color: '#FF3B30' },
  progresoBarraFondo: {
    height: 12,
    borderRadius: 6,
    backgroundColor: '#eee',
    overflow: 'hidden',
  },
  progresoBarraRelleno: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#007AFF',
  },
  progresoBarraRellenoExcedido: { backgroundColor: '#FF3B30' },
  progresoAlerta: { fontSize: 12, color: '#FF3B30', marginTop: 8, fontWeight: '600' },

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

  dineroRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  dineroCategoria: { fontSize: 14, color: '#444', flex: 1, marginRight: 8 },
  dineroValor: { fontSize: 14, fontWeight: '600', color: '#333' },
  dineroTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  dineroTotalLabel: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  dineroTotalValor: { fontSize: 20, fontWeight: 'bold', color: '#28a745' },

  // Estilos del selector de rango
  presetRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 10, gap: 10 },
  presetButton: { backgroundColor: '#d0e3ff', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20 },
  presetButtonText: { color: '#0056b3', fontWeight: '600', fontSize: 13 },
  presetButtonActivo: { backgroundColor: '#007AFF' },
  presetButtonTextActivo: { color: '#fff' },
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