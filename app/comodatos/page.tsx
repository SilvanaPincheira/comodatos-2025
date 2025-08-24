"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

// ==============================
// Defaults: tus hojas (Google Sheets nativos)
// ==============================
const DEFAULT_VENTAS_URL = "https://docs.google.com/spreadsheets/d/1ptMOxf5TNzv-cPnQ6j1Mp_-NYQX9QliS/edit#gid=871602912";
const DEFAULT_COMODATOS_URL = "https://docs.google.com/spreadsheets/d/1ptMOxf5TNzv-cPnQ6j1Mp_-NYQX9QliS/edit#gid=551810728";
const DEFAULT_CATALOG_URL = "https://docs.google.com/spreadsheets/d/1UXVAxwzg-Kh7AWCPnPbxbEpzXnRPR2pDBKrRUFNZKZo/edit?gid=0#gid=0"; // Catálogo por defecto

// ==============================
// Tipos base
// ==============================
type VentasRow = {
  rut: string;
  sn?: string; // ItemCode o SN
  fecha: string; // ISO yyyy-mm-dd
  monto: number; // total de la línea (CLP)
  qty?: number; // unidades
  kilos?: number; // kg de la línea (si existe en hoja)
  priceLine?: number; // total línea usado para precio/kg
  cliente?: string;
  prodName?: string;
};

type ComodatoRow = {
  rut: string;
  sn?: string;
  fecha_instalacion: string;
  meses_contrato: number;
  costo_total?: number;
  costo_mensual?: number;
  cliente?: string;
  isSalida?: boolean;
  entregado2yPair?: number;
};

type EquipoDetalle = {
  sn?: string;
  fechaInst: string;
  mesesContrato: number;
  mesesTranscurridos: number;
  mesesRestantes: number;
  costoMensual: number;
};

type Metric = {
  key: string;
  cliente?: string;
  // Ventas
  ventas6mTotal: number;
  ventas6mProm: number;
  ventas24mTotal: number;
  // Comodatos
  comodatoMensualVigente: number; // referencia
  comodato24mTotal: number;
  // Relación (24m)
  relacion: number;
  vigente: boolean;
  equiposVigentes: number;
  detalle: EquipoDetalle[];
  entregado2y?: number;
};

type KeyType = "RUT" | "SN";

// Catálogo para evaluación en vivo
type CatalogItem = {
  code: string;
  name: string;
  precio?: number; // precio unitario del equipo (o lista)
  costo_mensual?: number; // costo mensual sugerido (si existiera)
  costo_total?: number;
};

// Nuevos equipos solicitados (evaluación)
type SolicitudRow = {
  code: string;
  name: string;
  qty: number;
  meses: number;
  valorUnit?: number;      // $ del equipo unitario (ingresado o venido de catálogo)
  costoMensual?: number;   // opcional: si se quiere forzar mensual (override)
  costoTotal?: number;     // compatibilidad antigua (usada para migración)
};

// ==============================
// Utils
// ==============================
const moneyCL = (v: number) => "$" + Number(Math.round(v || 0)).toLocaleString("es-CL");
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

function useLocalStorage<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  return [state, setState] as const;
}

const isGoogleSheet = (url: string) => url.includes("docs.google.com/spreadsheets");
function normalizeGoogleSheetUrl(url: string): { csvUrl: string; id?: string; gid?: string } {
  try {
    if (!isGoogleSheet(url)) return { csvUrl: url };
    const idMatch = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = url.match(/[?&]gid=(\d+)/) || url.match(/#gid=(\d+)/);
    const id = idMatch?.[1];
    const gid = gidMatch?.[1];
    const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv` + (gid ? `&gid=${gid}` : "");
    return { csvUrl, id, gid };
  } catch {
    return { csvUrl: url };
  }
}

function detectDelimiterInText(sample: string): string {
  let inQ = false, cComma = 0, cSemi = 0;
  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (!inQ) {
      if (ch === ',') cComma++; else if (ch === ';') cSemi++; else if (ch === '\n' || ch === '\r') break;
    }
  }
  return cSemi > cComma ? ';' : ',';
}

function parseCSVRobusto(text: string) {
  const delim = detectDelimiterInText(text.slice(0, 1000));
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else { inQ = !inQ; }
      continue;
    }
    if (!inQ && (ch === delim)) { row.push(cur); cur = ""; continue; }
    if (!inQ && (ch === '\n')) { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
    if (!inQ && ch === '\r') { continue; }
    cur += ch;
  }
  row.push(cur); rows.push(row);
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows;
}

function rowsToObjects(rows: string[][]): any[] {
  if (!rows.length) return [];
  const headIdx = rows.findIndex(r => r.some((c) => c.trim() !== ""));
  if (headIdx < 0) return [];
  const header = rows[headIdx].map((h) => h.replace(/\r/g, '').trim());
  const out: any[] = [];
  for (let i = headIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => (c ?? '').trim() === "")) continue;
    const o: any = {};
    for (let j = 0; j < header.length; j++) o[header[j]] = r[j];
    out.push(o);
  }
  return out;
}

async function loadFromGviz(sheetId: string, gid?: string): Promise<any[]> {
  return await new Promise<any[]>((resolve, reject) => {
    const prevGoogle = (window as any).google;
    const ns: any = (window as any).google = (window as any).google || {};
    ns.visualization = ns.visualization || {};
    ns.visualization.Query = ns.visualization.Query || {};
    const timeout = setTimeout(() => { (window as any).google = prevGoogle; reject(new Error("Timeout GViz")); }, 15000);
    ns.visualization.Query.setResponse = (resp: any) => {
      clearTimeout(timeout); (window as any).google = prevGoogle;
      try {
        const table = resp?.table;
        const cols = (table?.cols || []).map((c: any, i: number) => c?.label || c?.id || `col${i+1}`);
        const out: any[] = [];
        for (const row of table?.rows || []) {
          const o: any = {}; (row?.c || []).forEach((cell: any, idx: number) => { o[cols[idx]] = cell?.v ?? ""; });
          out.push(o);
        }
        resolve(out);
      } catch (e) { reject(e); }
    };
    const s = document.createElement('script');
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?${gid ? `gid=${gid}&` : ''}tqx=out:json`;
    s.src = url; s.onerror = () => { (window as any).google = prevGoogle; reject(new Error("Script GViz error")); };
    document.body.appendChild(s);
  });
}

function tryParseDate(s: any): Date | null {
  if (!s) return null; if (s instanceof Date) return isNaN(+s) ? null : s;
  const t = String(s).trim(); if (!t) return null;
  const dIso = new Date(t); if (!isNaN(+dIso)) return dIso;
  const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const dd = parseInt(m[1], 10), mm = parseInt(m[2], 10)-1, yy = parseInt(m[3].length === 2 ? `20${m[3]}`: m[3], 10);
    const d = new Date(yy, mm, dd); return isNaN(+d) ? null : d;
  }
  return null;
}

function buildDateFromPeriodo(year: any, periodoMes: any, periodo?: any): Date | null {
  const y = Number(String(year ?? "").match(/\d{4}/)?.[0] ?? NaN);
  let m = Number(String(periodoMes ?? "").match(/\d{1,2}/)?.[0] ?? NaN);
  if (isNaN(m) && periodo) {
    const txt = String(periodo).toLowerCase();
    const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    const idx = meses.findIndex((x) => txt.includes(x)); if (idx >= 0) m = idx + 1;
  }
  if (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) return new Date(y, m - 1, 1);
  return null;
}

function monthDiff(from: Date, to: Date) {
  const years = to.getFullYear() - from.getFullYear();
  const months = to.getMonth() - from.getMonth();
  const total = years * 12 + months + (to.getDate() >= from.getDate() ? 0 : -1);
  return Math.max(0, total);
}

// Cuenta meses de solapamiento por mes calendario (ambos extremos inclusivos)
function countMonthOverlapInclusive(contractStart: Date, contractMonths: number, windowStart: Date, windowEnd: Date) {
  // Normalizar a inicio de mes
  const cStart = new Date(contractStart.getFullYear(), contractStart.getMonth(), 1);
  const cEnd = new Date(cStart.getFullYear(), cStart.getMonth() + Math.max(0, contractMonths) - 1, 1);
  const wStart = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
  const wEnd = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);
  const s = cStart > wStart ? cStart : wStart;
  const e = cEnd < wEnd ? cEnd : wEnd;
  if (e < s) return 0;
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1;
}

function num(v: any, def = 0) {
  const n = Number(String(v ?? "").replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? def : n;
}

// ==============================
// Página
// ==============================
export default function ComodatosActivosPage() {
  const [ventasUrl, setVentasUrl] = useLocalStorage<string>("comodatos.ventasUrl", DEFAULT_VENTAS_URL);
  const [comodatosUrl, setComodatosUrl] = useLocalStorage<string>("comodatos.comodatosUrl", DEFAULT_COMODATOS_URL);
  const [catalogUrl, setCatalogUrl] = useLocalStorage<string>("comodatos.catalogUrl", DEFAULT_CATALOG_URL);
  const [filtroTipo, setFiltroTipo] = useLocalStorage<KeyType>("comodatos.filtroTipo", "RUT");
  const [filtro, setFiltro] = useLocalStorage<string>("comodatos.filtro", "");
  const [relMax, setRelMax] = useLocalStorage<number>("comodatos.relMax", 0.20);
  const [contractMonthsDefault, setContractMonthsDefault] = useLocalStorage<number>("comodatos.contractMonths", 24);
  const [avgMode, setAvgMode] = useLocalStorage<"salesMonths" | "calendar6">("comodatos.avgMode", "salesMonths");
  const [ventasRows, setVentasRows] = useState<VentasRow[]>([]);
  const [comodatosRows, setComodatosRows] = useState<ComodatoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [ventasCount, setVentasCount] = useState<number>(0);
  const [comodatosCount, setComodatosCount] = useState<number>(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const today = new Date();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [filterBy, setFilterBy] = useState<'RUT'|'NOMBRE'>("RUT");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Estado para catálogo y evaluación en vivo
  const [catalog, setCatalog] = useState<Record<string, CatalogItem>>({});
  const [rows, setRows] = useState<SolicitudRow[]>([]);
  
  // Modo admin (para pegar URLs). Mostrar cuando hay ?admin=1
  const [showConfig] = useState<boolean>(() => {
    try { return new URLSearchParams(location.search).has("admin"); } catch { return false; }
  });

  // Autocargar por query (?ventas= & ?comodatos=) y por defaults
  useEffect(() => {
    try {
      const sp = new URLSearchParams(location.search);
      const q = sp.get("q") || sp.get("rut") || "";
      if (q) setFiltro(q);
      const tipo = (sp.get("key") || sp.get("tipo") || "").toUpperCase();
      if (tipo === "SN" || tipo === "RUT") setFiltroTipo(tipo as KeyType);
      const vParam = sp.get("ventas");
      const cParam = sp.get("comodatos");
      if (vParam && cParam) { setVentasUrl(vParam); setComodatosUrl(cParam); loadAll(vParam, cParam); }
      const catParam = sp.get("catalog");
      if (catParam) { setCatalogUrl(catParam); }
    } catch {}
    if (!ventasRows.length && !comodatosRows.length && ventasUrl && comodatosUrl) loadAll();
    if (catalogUrl && Object.keys(catalog).length === 0) { loadCatalog(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSheet(url: string): Promise<any[]> {
    if (!url) return [];
    const { csvUrl, id, gid } = normalizeGoogleSheetUrl(url);
    try {
      const resp = await fetch(csvUrl, { mode: "cors" as RequestMode });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const textRaw = new TextDecoder("utf-8").decode(new Uint8Array(buf));
      const text = textRaw.replace(/^\uFEFF/, "");
      const parsed = parseCSVRobusto(text);
      return rowsToObjects(parsed);
    } catch (err) {
      if (!id) throw err; // si no es sheet nativo
      return await loadFromGviz(id, gid);
    }
  }

  // ===== MAPEOS =====
  const mapVentas = (rows: any[]): VentasRow[] => {
    const out: VentasRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rut = String(r["Rut Cliente"] ?? r.rut ?? r.RUT ?? r["Codigo Cliente"] ?? r["odigo liente"] ?? "").trim();
      const sn = (String(r["ItemCode"] ?? r["SN"] ?? r["serie"] ?? r["Serie"] ?? "").trim().toUpperCase() || undefined);
      const cliente = (String(r["Nombre Cliente"] ?? r.cliente ?? r.Cliente ?? "").trim() || undefined);
      let d: Date | null = tryParseDate(r["DocDate"] ?? r["Fecha"] ?? r["Doc Date"]) || buildDateFromPeriodo(r["Año"] ?? r["Ano"], r["Periodo MES"], r["Periodo"]);
      if (!d) continue;
      const qty = num(r["Quantity"] ?? r["Unidades"] ?? r["Cantidad"], 0);

      // Kilos de la línea: usa "Cantidad Kilos" si existe; si no, Quantity * U_FACTORFLETE
      const factor = num(r["U_FACTORFLETE"] ?? r["factor"] ?? r["Factor"], 0);
      let kilos = num(r["Cantidad Kilos"] ?? r["Cantidad Kilos "] ?? r["Cantidad_Kilos"] ?? r["Kilos"] ?? r["KG"], 0);
      if (!kilos && factor && qty) kilos = factor * qty;

      // Total de la línea (ingreso): usa Global Venta/Total; si no, precio * qty * (1 - desc)
      let lineRevenue = NaN as number;
      const mGlobal = r["Global Venta"] ?? r["Global_Venta"] ?? r["Total"];
      if (mGlobal !== undefined && mGlobal !== null && String(mGlobal).trim() !== "") {
        lineRevenue = num(mGlobal);
      } else {
        const price = num(r["Precio Por Linea"] ?? r["PV antes del descuento"] ?? r["Precio"], 0);
        let disc = num(r["% Descuento"] ?? r["Descuento %"] ?? r["Descuento"], 0);
        if (disc > 1) disc = disc / 100; if (disc < 0 || disc > 1) disc = 0;
        lineRevenue = price * qty * (1 - disc);
      }
      const prodName = String(r["Dscription"] ?? r["U_DESCRIPCION_DET"] ?? r["Producto"] ?? r["DESCRIPCION"] ?? r["Descripcion"] ?? "").trim() || undefined;

      if (!rut) continue;
      out.push({ rut, sn, fecha: d.toISOString().slice(0, 10), monto: lineRevenue, qty, kilos, priceLine: lineRevenue, cliente, prodName });
    }
    return out.filter(v => v.rut && (v.monto || v.monto === 0) && v.fecha);
  };

  const mapComodatos = (rows: any[]): ComodatoRow[] => {
    const hasContractCols = rows.some((r) =>
      (r.fecha_instalacion ?? r.Fecha_Instalacion ?? r.Instalacion ?? r.Fecha) &&
      (r.meses_contrato ?? r.Meses_Contrato ?? r.meses ?? r.Meses)
    );

    if (hasContractCols) {
      const out: ComodatoRow[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const rut = String(r.rut ?? r.RUT ?? r.Rut ?? r["Rut Cliente"] ?? r.cliente_rut ?? r.Cliente_RUT ?? "").trim();
        const sn = (String(r.sn ?? r.SN ?? r.serie ?? r.Serie ?? r["Codigo Producto"] ?? r.cod_sn ?? r.Codigo_SN ?? "").trim() || undefined);
        const fecha_instalacion = String(r.fecha_instalacion ?? r.Fecha_Instalacion ?? r.Instalacion ?? r.Fecha ?? "").trim();
        const meses_contrato = num(r.meses_contrato ?? r.Meses_Contrato ?? r.meses ?? r.Meses ?? 0);
        const costo_total = r.costo_total !== undefined ? num(r.costo_total) : undefined;
        const costo_mensual = r.costo_mensual !== undefined ? num(r.costo_mensual) : undefined;
        const cliente = (String(r.cliente ?? r.Cliente ?? r["Nombre Cliente"] ?? r.razon ?? r.Razon ?? "").trim() || undefined);
        if (!rut || !fecha_instalacion || !(costo_total || costo_mensual) || !(meses_contrato > 0)) continue;
        out.push({ rut, sn, fecha_instalacion, meses_contrato, costo_total, costo_mensual, cliente, isSalida: false, entregado2yPair: 0 });
      }
      return out;
    }

    // === MODO "COMODATOS SALIDA" === (promedio mensual últimos 3 meses por RUT/SN + total 24m por par)
    type Row = { rut: string; sn?: string; fecha: Date; total: number; cliente?: string };
    const parsed: Row[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as any;
      const rut = String(r["Rut Cliente"] ?? r.rut ?? r.RUT ?? "").trim();
      const sn  = (String(r["Codigo Producto"] ?? r.sn ?? r.SN ?? r.serie ?? "").trim() || undefined);
      const cliente = (String(r["Nombre Cliente"] ?? r.cliente ?? r.Cliente ?? "").trim() || undefined);
      const totalRaw = r["Total"] ?? (num(r["Precio unitario"]) * num(r["Cantidad"]))
      const total = num(totalRaw);
      const f = tryParseDate(r["Fecha Contab"]) || buildDateFromPeriodo(r["Año"], r["Periodo MES"], r["Periodo"]);
      if (!rut || !total) continue;
      parsed.push({ rut, sn, fecha: f || new Date(), total, cliente });
    }
    if (!parsed.length) return [];

    const twoYearsAgo = new Date(today.getFullYear(), today.getMonth() - 24, 1);

    // Agrupar por (rut,sn)
    const byPair = new Map<string, { rut: string; sn?: string; cliente?: string; months: Map<string, number>; firstDate: Date }>();
    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i]; if (p.fecha < twoYearsAgo) continue;
      const key = `${p.rut}||${p.sn || ""}`;
      const rec = byPair.get(key) || { rut: p.rut, sn: p.sn, cliente: p.cliente, months: new Map<string, number>(), firstDate: p.fecha };
      const k = `${p.fecha.getFullYear()}-${String(p.fecha.getMonth() + 1).padStart(2, "0")}`;
      rec.months.set(k, (rec.months.get(k) || 0) + (p.total || 0));
      if (p.fecha < rec.firstDate) rec.firstDate = p.fecha;
      if (!rec.cliente && p.cliente) rec.cliente = p.cliente;
      byPair.set(key, rec);
    }

    const out: ComodatoRow[] = [];
    byPair.forEach((rec) => {
      const months: string[] = [];
      rec.months.forEach((_v, k) => months.push(k));
      months.sort();
      const last3 = months.slice(-3);
      let sum3 = 0; for (let i = 0; i < last3.length; i++) sum3 += rec.months.get(last3[i]) || 0;
      let total24 = 0; rec.months.forEach((v) => { total24 += v || 0; });
      const n = Math.max(1, last3.length);
      const costoMensual = sum3 / n;
      out.push({
        rut: rec.rut,
        sn: rec.sn,
        fecha_instalacion: (rec.firstDate || today).toISOString().slice(0, 10),
        meses_contrato: 999,
        costo_total: undefined,
        costo_mensual: costoMensual,
        cliente: rec.cliente,
        isSalida: true,
        entregado2yPair: total24,
      });
    });

    return out;
  };

  const loadAll = async (vUrlOverride?: string, cUrlOverride?: string) => {
    const vU = vUrlOverride ?? ventasUrl;
    const cU = cUrlOverride ?? comodatosUrl;
    try {
      if (!vU || !cU) { setLastError("Faltan URLs de hojas"); throw new Error("Faltan URLs de hojas"); }
      setLoading(true); setLastError(null);
      const [vRaw, cRaw] = await Promise.all([loadSheet(vU), loadSheet(cU)]);
      const v = mapVentas(vRaw);
      const c = mapComodatos(cRaw);
      setVentasRows(v); setComodatosRows(c);
      setVentasCount(v.length); setComodatosCount(c.length);
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || "Error al cargar hojas";
      setLastError(msg);
      const vCsv = normalizeGoogleSheetUrl(String(vU)).csvUrl;
      const cCsv = normalizeGoogleSheetUrl(String(cU)).csvUrl;
      alert(`No se pudo cargar alguna hoja.\n\nVentas URL: ${String(vU)}\nCSV ventas: ${vCsv}\nComodatos URL: ${String(cU)}\nCSV comodatos: ${cCsv}\n\nDetalle: ${msg}\n\nAsegúrate de:\n1) Compartir ambas hojas como "Cualquiera con el enlace – Lector".\n2) Estar usando el ID y GID del Google Sheet convertido (no el XLSX).\n3) Abre los enlaces CSV arriba; deben descargar un archivo.`);
    } finally { setLoading(false); }
  };

  async function loadCatalog(catUrl?: string) {
    const url = catUrl ?? catalogUrl; if (!url) return;
    try {
      const { csvUrl, id, gid } = normalizeGoogleSheetUrl(url);
      let rows: any[] = [];
      // 1) CSV directo
      try {
        const resp = await fetch(csvUrl, { mode: 'cors' as RequestMode });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const textRaw = new TextDecoder('utf-8').decode(new Uint8Array(buf));
        const text = textRaw.replace(/^﻿/, '');
        const csv = parseCSVRobusto(text);
        rows = rowsToObjects(csv);
      } catch (csvErr) {
        // 2) Fallback GViz (sin CORS)
        if (!id) throw csvErr;
        const gviz = await loadFromGviz(id, gid);
        rows = gviz;
      }
      const map: Record<string, CatalogItem> = {};
      for (let i = 0; i < rows.length; i++) {
        const r: any = rows[i];
        const code = String(r.code ?? r.CODIGO ?? r.Codigo ?? r.ItemCode ?? r.Codigo_Producto ?? '').trim().toUpperCase();
        if (!code) continue;
        const name = String(r.name ?? r.Nombre ?? r.NOMBRE ?? r.Producto ?? r.Dscription ?? '').trim();
        const priceList = Number(r.price_list ?? r.lista ?? r.precio ?? r.Price ?? 0) || 0;
        const cost = r.cost !== undefined && r.cost !== '' ? Number(r.cost) : undefined;
        const kilos = r.kilos !== undefined && r.kilos !== '' ? Number(r.kilos) : undefined;
        map[code] = {
          code,
          name,
          precio: priceList,
          costo_mensual: cost ?? priceList, // para equipos, usar cost si existe; si no, fallback a lista
          costo_total: undefined,
        };
        if (kilos !== undefined) (map as any)[code].kilos = kilos;
      }
      setCatalog(map);
    } catch (e: any) {
      alert("No se pudo cargar el catálogo. Revisa que el enlace sea público y las columnas (code, name, price_list, cost, kilos).\nDetalle: " + (e?.message || e));
    }
  }

  const handleLoadClick = () => {
    if (!ventasUrl || !comodatosUrl) {
      setLastError("Faltan URLs de hojas");
      alert("Faltan URLs de hojas. Abre /comodatos?admin=1 para configurarlas y vuelve a intentar.");
      return;
    }
    loadAll();
  };

  const loadDemo = () => {
    const hoy = new Date();
    const d = (offM: number) => new Date(hoy.getFullYear(), hoy.getMonth() - offM, 15).toISOString().slice(0,10);
    const ventasDemo: VentasRow[] = [
      { rut: "76.123.456-7", sn: "PT-001", fecha: d(1), monto: 900000, cliente: "Cliente A", qty: 10 },
      { rut: "76.123.456-7", sn: "PT-001", fecha: d(2), monto: 950000, cliente: "Cliente A", qty: 12 },
      { rut: "76.123.456-7", sn: "PT-002", fecha: d(3), monto: 800000, cliente: "Cliente A", qty: 8 },
      { rut: "99.888.777-6", sn: "PT-100", fecha: d(1), monto: 400000, cliente: "Cliente B", qty: 5 },
      { rut: "99.888.777-6", sn: "PT-100", fecha: d(2), monto: 420000, cliente: "Cliente B", qty: 7 },
      { rut: "99.888.777-6", sn: "PT-101", fecha: d(3), monto: 0, cliente: "Cliente B", qty: 0 },
    ];
    const comodDemo: ComodatoRow[] = [
      { rut: "76.123.456-7", sn: "SN-001", fecha_instalacion: d(10), meses_contrato: 24, costo_total: 12000000, cliente: "Cliente A" },
      { rut: "76.123.456-7", sn: "SN-002", fecha_instalacion: d(5),  meses_contrato: 18, costo_total: 6000000, cliente: "Cliente A" },
      { rut: "99.888.777-6", sn: "SN-100", fecha_instalacion: d(20), meses_contrato: 24, costo_total: 9600000, cliente: "Cliente B" },
      { rut: "99.888.777-6", sn: "SN-101", fecha_instalacion: d(25), meses_contrato: 12, costo_total: 4800000, cliente: "Cliente B" },
    ];
    setVentasRows(ventasDemo); setComodatosRows(comodDemo);
    setVentasCount(ventasDemo.length); setComodatosCount(comodDemo.length);
    setLastError(null); setFiltro(""); setFiltroTipo("RUT");
  };

  // KPIs
  const metrics = useMemo<Metric[]>(() => {
    if (!ventasRows.length && !comodatosRows.length) return [];
    const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate());
    const twoYearsAgo = new Date(today.getFullYear(), today.getMonth() - 24, 1);

    // Ventas por clave (6m y 24m)
    const sales6ByKey = new Map<string, { total: number; countMonths: number; monthsSet: Set<string>; anyName?: string }>();
    const sales24ByKey = new Map<string, { total: number; anyName?: string }>();

    for (let i = 0; i < ventasRows.length; i++) {
      const v = ventasRows[i];
      const d = tryParseDate(v.fecha); if (!d) continue;
      const key = (filtroTipo === "RUT" ? v.rut : (v.sn || "")).trim(); if (!key) continue;
      const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      // 6m rolling
      if (d >= sixMonthsAgo) {
        const rec6 = sales6ByKey.get(key) || { total: 0, countMonths: 0, monthsSet: new Set<string>(), anyName: v.cliente };
        rec6.total += v.monto || 0; rec6.anyName = rec6.anyName || v.cliente;
        if (!rec6.monthsSet.has(ym)) { rec6.monthsSet.add(ym); rec6.countMonths++; }
        sales6ByKey.set(key, rec6);
      }
      // 24m
      if (d >= twoYearsAgo) {
        const rec24 = sales24ByKey.get(key) || { total: 0, anyName: v.cliente };
        rec24.total += v.monto || 0; rec24.anyName = rec24.anyName || v.cliente;
        sales24ByKey.set(key, rec24);
      }
    }

    // Comodatos por clave (equipos + cálculo 24m acumulado en meses vigentes)
    const comodByKey = new Map<string, { equipos: EquipoDetalle[]; cliente?: string; comod24Total: number }>();
    for (let i = 0; i < comodatosRows.length; i++) {
      const c = comodatosRows[i];
      const key = (filtroTipo === "RUT" ? c.rut : (c.sn || "")).trim(); if (!key) continue;
      const fi = tryParseDate(c.fecha_instalacion); if (!fi) continue;
      const mesesTranscurridos = monthDiff(fi, today);
      const mesesRestantes = Math.max(0, (c.meses_contrato || 0) - mesesTranscurridos);
      const mesesBase = (c.meses_contrato && c.meses_contrato > 0 ? c.meses_contrato : contractMonthsDefault || 1);
      const costoMensual = c.costo_mensual !== undefined ? (c.costo_mensual || 0) : ((c.costo_total || 0) / mesesBase);
      const det: EquipoDetalle = { sn: c.sn, fechaInst: fi.toISOString().slice(0,10), mesesContrato: mesesBase, mesesTranscurridos, mesesRestantes, costoMensual };
      const rec = comodByKey.get(key) || { equipos: [], cliente: c.cliente, comod24Total: 0 };
      rec.equipos.push(det); if (!rec.cliente && c.cliente) rec.cliente = c.cliente;
      // Acumulado 24m: meses de contrato que caen dentro de la ventana de 24 meses y hasta hoy
      const monthsOverlap = countMonthOverlapInclusive(fi, mesesBase, twoYearsAgo, today);
      rec.comod24Total += (costoMensual || 0) * monthsOverlap;
      comodByKey.set(key, rec);
    }

    // Entregado 24m (solo modo salida)
    const entregadoByKey = new Map<string, number>();
    for (let i = 0; i < comodatosRows.length; i++) {
      const c = comodatosRows[i];
      if (!c || !c.isSalida) continue;
      const key = (filtroTipo === "RUT" ? c.rut : (c.sn || "")).trim();
      if (!key) continue;
      const add = c.entregado2yPair || 0;
      entregadoByKey.set(key, (entregadoByKey.get(key) || 0) + add);
    }

    const keys = new Set<string>();
    sales6ByKey.forEach((_v, k) => keys.add(k));
    sales24ByKey.forEach((_v, k) => keys.add(k));
    comodByKey.forEach((_v, k) => keys.add(k));

    const out: Metric[] = [];
    keys.forEach((k) => {
      const s6 = sales6ByKey.get(k);
      const s24 = sales24ByKey.get(k);
      const cRec = comodByKey.get(k);
      const ventas6mTotal = s6?.total || 0;
      const ventas6mProm = s6 ? (avgMode === "calendar6" ? s6.total / 6 : (s6.countMonths ? s6.total / s6.countMonths : 0)) : 0;
      const ventas24mTotal = s24?.total || 0;
      const equiposVig = (cRec?.equipos || []).filter(e => e.mesesRestantes > 0);
      const comodatoMensualVigente = equiposVig.reduce((a, e) => a + e.costoMensual, 0);
      // Nuevo: usar TOTAL RESTANTE de comodatos vigentes (mesesRestantes * costoMensual)
      const comodato24mTotal = equiposVig.reduce((a, e) => a + (e.costoMensual || 0) * (e.mesesRestantes || 0), 0);
      const relacion = ventas6mProm > 0 ? (comodatoMensualVigente / ventas6mProm) : 0; // NUEVO: cuota mensual / promedio mensual de ventas
      out.push({
        key: k,
        cliente: cRec?.cliente || s6?.anyName || s24?.anyName,
        ventas6mTotal, ventas6mProm, ventas24mTotal,
        comodatoMensualVigente, comodato24mTotal,
        relacion,
        vigente: equiposVig.length > 0,
        equiposVigentes: equiposVig.length,
        detalle: cRec?.equipos || [],
        entregado2y: entregadoByKey.get(k) || 0
      });
    });

    out.sort((a, b) => (Number(b.vigente) - Number(a.vigente)) || (b.relacion - a.relacion));
    return out;
  }, [ventasRows, comodatosRows, filtroTipo, today, avgMode, contractMonthsDefault]);

  // Métrica activa para evaluación en vivo
  const activeMetric = useMemo(() => metrics.find(m => m.key === activeKey) || null, [metrics, activeKey]);

  // Solo vigentes + filtro de búsqueda (si escribes en el input de filtro básico)
  const filtered = useMemo(() => {
    const q = (filtro || "").toLowerCase();
    const base = metrics.filter(m => m.vigente);
    if (!q) return base;
    if (filterBy === 'RUT') {
      return base.filter(m => m.key.toLowerCase().includes(q));
    }
    return base.filter(m => (m.cliente || '').toLowerCase().includes(q));
  }, [metrics, filtro, filterBy]);

  // === Top productos (6m) promediado por mes para el RUT buscado ===
  const topProds = useMemo(() => {
    if (filtroTipo !== 'RUT' || !filtro) return [] as { sn: string; name?: string; totalKilos: number; priceVentaKg: number; total: number }[];
    const rut = filtro.trim();
    // Últimos 6 meses contados desde hoy (incluye meses sin venta al promediar)
    const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 6, today.getDate());
    const acc: Record<string, { name?: string; kilos: number; revenue: number }> = {};

    for (let i = 0; i < ventasRows.length; i++) {
      const v = ventasRows[i];
      const d = tryParseDate(v.fecha);
      if (!d || d < sixMonthsAgo) continue; // rolling 6m
      if (v.rut !== rut) continue;
      const code = (v.sn || '').toUpperCase();
      if (!code || !code.startsWith('PT')) continue; // solo PT*
      const kilos = Number(v.kilos || 0);
      const rev = Number(v.monto || 0);
      const rec = acc[code] || { name: v.prodName, kilos: 0, revenue: 0 };
      rec.kilos += kilos;
      rec.revenue += rev;
      if (!rec.name && v.prodName) rec.name = v.prodName;
      acc[code] = rec;
    }

    const monthsCount = 6; // promedio mensual en 6 meses calendario
    const out = Object.keys(acc).map((sn) => {
      const a = acc[sn];
      const totalKilos = a.kilos / monthsCount;      // promedio mensual (incluye meses sin venta)
      const total = a.revenue / monthsCount;         // promedio mensual (incluye meses sin venta)
      const priceVentaKg = a.kilos > 0 ? a.revenue / a.kilos : 0; // CLP/kg global del período
      return { sn, name: a.name, totalKilos, priceVentaKg, total };
    }).sort((x, y) => y.total - x.total).slice(0, 10);

    return out;
  }, [ventasRows, filtroTipo, filtro, today]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-40 relative overflow-hidden">
        <div className="absolute inset-0 bg-[#1f4ed8]" />
        <div className="absolute inset-y-0 right-[-20%] w-[60%] rotate-[-8deg] bg-sky-400/60" />
        <div className="relative mx-auto max-w-7xl px-6 py-5 flex items-center justify-between">
          <h1 className="text-white uppercase font-semibold tracking-widest text-2xl md:text-3xl">Comodatos – Clientes Activos</h1>
          <div className="flex items-center gap-2">
            <Link href="/" className="rounded bg-white/20 text-white px-3 py-1 text-xs sm:text-sm hover:bg-white/30">⟵ Volver</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {showConfig && (
          <section className="rounded-2xl border bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-4 text-lg font-semibold text-[#2B6CFF]">⚙️ Fuentes (Google Sheets)</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">Ventas (últimos 6 meses)
                <div className="mt-1 flex gap-2">
                  <input className="flex-1 rounded border px-2 py-1" placeholder="URL de Google Sheet o CSV" value={ventasUrl} onChange={(e) => setVentasUrl(e.target.value)} />
                  <button type="button" onClick={() => { const { csvUrl } = normalizeGoogleSheetUrl(ventasUrl); window.open(csvUrl, '_blank', 'noopener'); }} className="rounded border px-2 py-1 text-xs">Probar CSV</button>
                </div>
                <div className="text-[11px] text-zinc-500 mt-1 break-all">CSV: {normalizeGoogleSheetUrl(ventasUrl).csvUrl}</div>
              </label>
              <label className="text-sm">Comodatos vigentes (últimos 2 años)
                <div className="mt-1 flex gap-2">
                  <input className="flex-1 rounded border px-2 py-1" placeholder="URL de Google Sheet o CSV" value={comodatosUrl} onChange={(e) => setComodatosUrl(e.target.value)} />
                  <button type="button" onClick={() => { const { csvUrl } = normalizeGoogleSheetUrl(comodatosUrl); window.open(csvUrl, '_blank', 'noopener'); }} className="rounded border px-2 py-1 text-xs">Probar CSV</button>
                </div>
                <div className="text-[11px] text-zinc-500 mt-1 break-all">CSV: {normalizeGoogleSheetUrl(comodatosUrl).csvUrl}</div>
              </label>
              <label className="text-sm md:col-span-2">Catálogo (opcional, para evaluación)
                <div className="mt-1 flex gap-2">
                  <input className="flex-1 rounded border px-2 py-1" placeholder="URL de Google Sheet o CSV con columnas code, name, price_list/costo_mensual" value={catalogUrl} onChange={(e)=> setCatalogUrl(e.target.value)} />
                  <button type="button" onClick={() => { const { csvUrl } = normalizeGoogleSheetUrl(catalogUrl); window.open(csvUrl, '_blank', 'noopener'); }} className="rounded border px-2 py-1 text-xs">Probar CSV</button>
                  <button type="button" onClick={() => loadCatalog()} className="rounded border px-2 py-1 text-xs">Cargar catálogo</button>
                </div>
                <div className="text-[11px] text-zinc-500 mt-1 break-all">Códigos cargados: {Object.keys(catalog).length || 0}</div>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <span>Clave</span>
                <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as KeyType)} className="rounded border px-2 py-1">
                  <option value="RUT">RUT</option>
                  <option value="SN">Código SN</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span>Filtro</span>
                <input className="rounded border px-2 py-1" placeholder={filtroTipo === "RUT" ? "Ej: 76.123.456-7" : "Ej: SN-001"} value={filtro} onChange={(e) => setFiltro(e.target.value)} />
              </label>
              <label className="flex items-center gap-2">
                <span>Umbral Relación</span>
                <input type="number" step={0.01} min={0} max={1} className="w-24 rounded border px-2 py-1 text-right" value={relMax} onChange={(e) => setRelMax(Number(e.target.value))} />
                <span className="text-zinc-500">{pct(relMax)}</span>
              </label>
              <button onClick={() => loadAll()} disabled={loading || !ventasUrl || !comodatosUrl} className="rounded bg-[#2B6CFF] hover:bg-[#1F5AE6] px-3 py-1.5 text-xs text-white disabled:opacity-50">{loading ? "Cargando..." : "Cargar hojas"}</button>
              <button onClick={loadDemo} className="rounded border px-3 py-1.5 text-xs">Cargar demo</button>
            </div>
            <p className="mt-2 text-xs text-zinc-500">Este módulo también soporta tu pestaña <b>“Comodatos Salida”</b> (Año, Periodo MES, Fecha Contab, Total, Rut Cliente, Nombre Cliente, Codigo Producto): se calcula un costo mensual como <i>promedio de los últimos 3 meses</i> por RUT/SN.</p>
          </section>
        )}

        <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold text-[#2B6CFF]">📊 Evaluación de Comodatos</h2>

          <div className="mb-4 flex flex-wrap items-end gap-3 justify-between">
            <div className="flex items-center gap-3">
              <label className="text-sm flex items-center gap-2">
                <span className="text-zinc-600">Meses contrato (def.)</span>
                <input type="number" min={1} className="w-20 rounded border px-2 py-1 text-right" value={contractMonthsDefault} onChange={(e) => setContractMonthsDefault(Math.max(1, Number(e.target.value)))} />
              </label>
            </div>
            <div className="flex items-end gap-2">
              <label className="text-xs">
                <span className="block text-zinc-500">Filtrar por</span>
                <select value={filterBy} onChange={(e)=>setFilterBy(e.target.value as any)} className="rounded border px-2 py-1">
                  <option value="RUT">RUT</option>
                  <option value="NOMBRE">Nombre</option>
                </select>
              </label>
              <input className="rounded border px-2 py-1" placeholder={filterBy==='RUT'? 'Ej: 76.123.456-7' : 'Nombre cliente'} value={query} onChange={(e)=>setQuery(e.target.value)} />
              <button onClick={()=>setFiltro(query)} className="rounded bg-[#2B6CFF] hover:bg-[#1F5AE6] px-3 py-1.5 text-xs text-white">Buscar</button>
              <button onClick={()=>{ setQuery(''); setFiltro(''); }} className="rounded border px-3 py-1.5 text-xs">Limpiar</button>
              <button onClick={handleLoadClick} className="rounded border px-3 py-1.5 text-xs">Cargar hojas</button>
              <button onClick={loadDemo} className="rounded border px-3 py-1.5 text-xs">Cargar demo</button>
            </div>
          </div>

          <div className="w-full flex flex-wrap items-center gap-3 text-xs text-zinc-600 mt-2">
            <span>Mostrando solo <b>comodatos vigentes</b>.</span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5">Ventas: {ventasCount}</span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5">Comodatos: {comodatosCount}</span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5">Entregado 24m (filtro): {moneyCL(filtered.reduce((a, b) => a + (b.entregado2y || 0), 0))}</span>
            {lastError && <span className="text-red-600">Error: {lastError}</span>}
          </div>

          <div className="overflow-x-auto mt-3">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#2B6CFF] text-white">
                  <th className="border px-2 py-1 text-left">{filtroTipo}</th>
                  <th className="border px-2 py-1 text-left">Cliente</th>
                  <th className="border px-2 py-1 text-right">Venta 24m total</th>
                  <th className="border px-2 py-1 text-right">Entregado 24m</th>
                  <th className="border px-2 py-1 text-right">Venta prom/m (6m)</th>
                  <th className="border px-2 py-1 text-right">Cuota mensual $</th>
                  <th className="border px-2 py-1 text-right">Relación mensual</th>
                  <th className="border px-2 py-1 text-center">Vigente</th>
                  <th className="border px-2 py-1 text-center">Equipos</th>
                  <th className="border px-2 py-1 text-center">Simular</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={10} className="border px-2 py-3 text-center text-zinc-500">Sin datos para mostrar</td></tr>
                )}
                {filtered.map((m, idx) => (
                  <React.Fragment key={m.key}>
                    <tr className={idx % 2 ? "bg-zinc-50" : undefined}>
                      <td className="border px-2 py-1 align-top">{m.key}</td>
                      <td className="border px-2 py-1 align-top">{m.cliente || "—"}</td>
                      <td className="border px-2 py-1 align-top text-right">{moneyCL(m.ventas24mTotal)}</td>
                      <td className="border px-2 py-1 align-top text-right">{moneyCL(m.entregado2y || 0)}</td>
                      <td className="border px-2 py-1 align-top text-right">{moneyCL(m.ventas6mProm)}</td>
                      <td className={`border px-2 py-1 align-top text-right ${m.relacion <= relMax ? 'text-emerald-700' : 'text-red-700'}`}>{moneyCL(m.comodatoMensualVigente)}</td>
                      <td className={`border px-2 py-1 align-top text-right ${m.relacion <= relMax ? 'text-emerald-700' : 'text-red-700'}`}>{pct(m.relacion)}</td>
                      <td className="border px-2 py-1 align-top text-center">{m.vigente ? "Sí" : "No"}</td>
                      <td className="border px-2 py-1 align-top text-center">{m.equiposVigentes}</td>
                      <td className="border px-2 py-1 align-top text-center">
                        <button className="rounded border px-2 py-0.5 text-xs" onClick={() => setActiveKey(m.key)}>{activeKey===m.key?'Seleccionado':'Evaluar'}</button>
                      </td>
                    </tr>
                    {m.detalle.length > 0 && (
                      <tr>
                        <td className="border px-2 py-2" colSpan={10}>
                          <div className="flex items-center justify-between text-xs text-zinc-600 mb-1">
                            <div>Detalle equipos vigentes</div>
                            {(() => { const total = m.detalle.filter(d => d.mesesRestantes > 0).length; const isOpen = !!expanded[m.key];
                              return total > 5 ? (
                                <button onClick={() => setExpanded(prev => ({ ...prev, [m.key]: !isOpen }))} className="rounded border px-2 py-0.5 text-[11px]">{isOpen ? `Ocultar (mostrar 5)` : `Mostrar todos (${total})`}</button>
                              ) : null;
                            })()}
                          </div>
                          <div className="overflow-x-auto">
                            {(() => {
                              const detVig = m.detalle.filter(d => d.mesesRestantes > 0);
                              detVig.sort((a, b) => (b.fechaInst || '').localeCompare(a.fechaInst || ''));
                              const isOpen = !!expanded[m.key];
                              const shown = isOpen ? detVig : detVig.slice(0, 5);
                              const sumShown = shown.reduce((a,d)=>a + (d.costoMensual||0) * (d.mesesRestantes||0), 0);
                              return (
                                <table className="w-full border-collapse text-xs">
                                  <thead>
                                    <tr className="bg-zinc-100 text-zinc-700">
                                      <th className="border px-2 py-1 text-left">SN</th>
                                      <th className="border px-2 py-1 text-left">Instalación</th>
                                      <th className="border px-2 py-1 text-right">Meses contrato</th>
                                      <th className="border px-2 py-1 text-right">Transcurridos</th>
                                      <th className="border px-2 py-1 text-right">Restantes</th>
                                      <th className="border px-2 py-1 text-right">Costo mensual</th>
                                      <th className="border px-2 py-1 text-right">Total restante</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {shown.map((d, i) => (
                                      <tr key={i}>
                                        <td className="border px-2 py-1">{d.sn || "—"}</td>
                                        <td className="border px-2 py-1">{d.fechaInst}</td>
                                        <td className="border px-2 py-1 text-right">{d.mesesContrato}</td>
                                        <td className="border px-2 py-1 text-right">{d.mesesTranscurridos}</td>
                                        <td className="border px-2 py-1 text-right">{d.mesesRestantes}</td>
                                        <td className="border px-2 py-1 text-right">{moneyCL(d.costoMensual)}</td>
                                        <td className="border px-2 py-1 text-right">{moneyCL((d.costoMensual||0) * (d.mesesRestantes||0))}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                  <tfoot>
                                    <tr>
                                      <td className="border px-2 py-1 text-right" colSpan={5}><b>Total</b></td>
                                      <td className="border px-2 py-1 text-right">{moneyCL(sumShown)}</td>
                                    </tr>
                                  </tfoot>
                                </table>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {activeMetric && (
          <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm dark:bg-zinc-900">
            <h2 className="mb-3 text-lg font-semibold text-[#2B6CFF]">🧪 Evaluación en vivo — {activeMetric.cliente || 'Cliente'} ({activeMetric.key})</h2>
            <div className="text-xs text-zinc-600 mb-2">Cuota mensual = (Valor equipo × Cantidad / Meses) salvo que se ingrese un "$ mensual" manual.</div>

            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold text-sm">Nuevos equipos a solicitar</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => loadCatalog()} className="rounded border px-2 py-1 text-xs">Refrescar catálogo</button>
                <button onClick={() => setRows([])} className="rounded border px-2 py-1 text-xs">Vaciar</button>
                <button onClick={() => setRows((s)=>[...s, { code: "", name: "", qty: 1, meses: contractMonthsDefault }])} className="rounded bg-[#2B6CFF] hover:bg-[#1F5AE6] px-3 py-1 text-xs text-white">+ Equipo</button>
              </div>
            </div>

            <datalist id="catCodes">
              {Object.keys(catalog).slice(0,5000).map((k)=> (
                <option key={k} value={k}>{catalog[k].name}</option>
              ))}
            </datalist>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-zinc-100 text-zinc-700">
                    <th className="border px-2 py-1 text-left">Código</th>
                    <th className="border px-2 py-1 text-left">Descripción</th>
                    <th className="border px-2 py-1 text-right">Cant.</th>
                    <th className="border px-2 py-1 text-right">Meses</th>
                    <th className="border px-2 py-1 text-right">$ equipo (unit)</th>
                    <th className="border px-2 py-1 text-right">$ total</th>
                    <th className="border px-2 py-1 text-right">$ mensual</th>
                    <th className="border px-2 py-1 text-center">—</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td className="border px-2 py-2 text-center text-zinc-500" colSpan={8}>Sin equipos. Usa "+ Equipo" o carga catálogo para autocompletar códigos.</td></tr>
                  )}
                  {rows.map((r, i) => {
                    const qty = Math.max(1, Number(r.qty || 1));
                    const meses = Math.max(1, Number(r.meses || contractMonthsDefault));
                    const unit = Number(r.valorUnit ?? (r.costoTotal !== undefined ? r.costoTotal : 0));
                    const totalEquip = unit * qty;
                    const mensual = r.costoMensual !== undefined && r.costoMensual !== null && r.costoMensual !== 0
                      ? Number(r.costoMensual) * qty
                      : (meses > 0 ? totalEquip / meses : 0);
                    return (
                      <tr key={i}>
                        <td className="border px-2 py-1"><input list="catCodes" className="w-40 rounded border px-1 py-0.5" value={r.code} onChange={(e)=>{ const it = catalog[e.target.value?.toUpperCase?.() || ""]; setRows((s)=>{ const n=[...s]; n[i].code=e.target.value.toUpperCase(); if (it){ n[i].name=it.name; if (!n[i].valorUnit && !n[i].costoTotal) n[i].valorUnit = it.costo_total ?? it.precio ?? 0; if (!n[i].costoMensual && it.costo_mensual) n[i].costoMensual = undefined; } return n;}); }} placeholder="Código" /></td>
                        <td className="border px-2 py-1"><input className="w-full rounded border px-1 py-0.5" value={r.name} onChange={(e)=>{ const v=e.target.value; setRows((s)=>{ const n=[...s]; n[i].name=v; return n;}); }} placeholder="Descripción" /></td>
                        <td className="border px-2 py-1 text-right"><input type="number" className="w-20 rounded border px-1 py-0.5 text-right" value={r.qty} onChange={(e)=>{ const v=Number(e.target.value); setRows((s)=>{ const n=[...s]; n[i].qty=v; return n;}); }} /></td>
                        <td className="border px-2 py-1 text-right"><input type="number" className="w-20 rounded border px-1 py-0.5 text-right" value={r.meses} onChange={(e)=>{ const v=Math.max(1, Number(e.target.value)); setRows((s)=>{ const n=[...s]; n[i].meses=v; return n;}); }} /></td>
                        <td className="border px-2 py-1 text-right"><input type="number" className="w-28 rounded border px-1 py-0.5 text-right" value={r.valorUnit ?? ''} onChange={(e)=>{ const v=e.target.value; setRows((s)=>{ const n=[...s]; n[i].valorUnit = v===''? undefined:Number(v); return n;}); }} placeholder="$ equipo" /></td>
                        <td className="border px-2 py-1 text-right">{moneyCL(totalEquip)}</td>
                        <td className="border px-2 py-1 text-right">{moneyCL(mensual)}</td>
                        <td className="border px-2 py-1 text-center"><button className="rounded bg-red-100 text-red-700 px-2 py-0.5" onClick={()=> setRows((s)=> s.filter((_,idx)=>idx!==i))}>×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {(() => {
              let cuotaSim = 0; for (let i = 0; i < rows.length; i++) { const r = rows[i]; const qty = Math.max(1, Number(r.qty || 1)); const meses = Math.max(1, Number(r.meses || contractMonthsDefault)); const unit = Number(r.valorUnit ?? (r.costoTotal !== undefined ? r.costoTotal : 0)); const totalEquip = unit * qty; const mensual = r.costoMensual !== undefined && r.costoMensual !== null && r.costoMensual !== 0 ? Number(r.costoMensual) * qty : (meses > 0 ? totalEquip / meses : 0); cuotaSim += (mensual || 0); }
              const cuotaNueva = (activeMetric.comodatoMensualVigente || 0) + (cuotaSim || 0);
              const relacionNueva = activeMetric.ventas6mProm > 0 ? (cuotaNueva / activeMetric.ventas6mProm) : 0;
              const viable = relacionNueva <= relMax;
              return (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
                  <div className="rounded border p-3"><div className="text-zinc-500 text-xs">Promedio ventas (6m)</div><div className="font-semibold">{moneyCL(activeMetric.ventas6mProm)}</div></div>
                  <div className="rounded border p-3"><div className="text-zinc-500 text-xs">Cuota vigente</div><div className="font-semibold">{moneyCL(activeMetric.comodatoMensualVigente)}</div></div>
                  <div className="rounded border p-3"><div className="text-zinc-500 text-xs">Cuota simulada</div><div className="font-semibold">{moneyCL(cuotaSim)}</div></div>
                  <div className="rounded border p-3"><div className="text-zinc-500 text-xs">Cuota nueva</div><div className="font-semibold">{moneyCL(cuotaNueva)}</div></div>
                  <div className="rounded border p-3"><div className="text-zinc-500 text-xs">Relación nueva</div><div className={`font-semibold ${viable ? 'text-emerald-700' : 'text-red-700'}`}>{pct(relacionNueva)}</div></div>
                  <div className="md:col-span-5">
                    <span className={`inline-block rounded-full px-3 py-1 text-white ${viable ? 'bg-emerald-600' : 'bg-red-600'}`}>{viable ? 'Viable' : 'No viable'}</span>
                    <button className="ml-3 rounded border px-2 py-1 text-xs" onClick={()=>setActiveKey(null)}>Cerrar</button>
                  </div>
                </div>
              );
            })()}
          </section>
        )}

        {/* === Top de productos (6m promedio mensual) para el RUT buscado === */}
        {filtroTipo === 'RUT' && filtro ? (
          <section className="mt-6 rounded-2xl border bg-white p-4 shadow-sm dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#2B6CFF]">📊 Top productos (últimos 6 meses, promedio mensual)</h2>
              <div className="text-xs text-zinc-500">Solo códigos PT*</div>
            </div>
            {topProds.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-zinc-100 text-zinc-700">
                      <th className="border px-2 py-1 text-left">Código</th>
                      <th className="border px-2 py-1 text-left">Descripción</th>
                      <th className="border px-2 py-1 text-right">Total kilos</th>
                      <th className="border px-2 py-1 text-right">Precio venta kg</th>
                      <th className="border px-2 py-1 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProds.map((t) => (
                      <tr key={t.sn}>
                        <td className="border px-2 py-1 align-top">{t.sn}</td>
                        <td className="border px-2 py-1 align-top">{t.name || '—'}</td>
                        <td className="border px-2 py-1 align-top text-right">{Number(Math.round(t.totalKilos || 0)).toLocaleString('es-CL')}</td>
                        <td className="border px-2 py-1 align-top text-right">{moneyCL(Math.round(t.priceVentaKg || 0))}</td>
                        <td className="border px-2 py-1 align-top text-right">{moneyCL(Math.round(t.total || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-zinc-500">Busca un <b>RUT</b> y carga hojas para ver el Top (6m).</div>
            )}
          </section>
        ) : null}

      </main>
    </div>
  );
}
