"use client";

import Link from "next/link";

import React, { useEffect, useMemo, useRef, useState } from "react";

// ===================== Tipos =====================
type CatalogItem = {
  code: string;
  name: string;
  price_list: number; // $/kg o costo mensual equipo
  cost?: number; // $/kg
  kilos?: number; // kg por presentación
};

type SaleLine = {
  code: string;
  name: string;
  priceList: number; // $/kg (lista, solo lectura)
  kilos: number; // kg/presentación
  qty: number; // presentaciones por mes
  sellPrice: number; // $/kg (precio de venta)
  // ==== NUEVO ====
  discountPct?: number; // 0..1
  costOverride?: number; // $/kg, opcional
};

type ComodatoLine = {
  code: string;
  name: string;
  priceList: number; // costo mensual del equipo
  qty: number; // cantidad de equipos
};

// Fallback seguro para logos remotos (evita CORS/tainted canvas)
const LOGO_FALLBACK_DATA =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="64"><rect width="100%25" height="100%25" fill="%231f4ed8"/><text x="50%25" y="55%25" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="20" fill="%23FFFFFF">LOGO</text></svg>';

// URL de catálogo por defecto (para invitados/incógnito)
const DEFAULT_CATALOG_URL =
  "https://docs.google.com/spreadsheets/d/1UXVAxwzg-Kh7AWCPnPbxbEpzXnRPR2pDBKrRUFNZKZo/export?format=csv";

// ===================== Utils =====================
const money = (v: number) =>
  v.toLocaleString(undefined, {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  });
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const moneyCL = (v: number) => "$" + Number(v || 0).toLocaleString("es-CL");
const cn = (...classes: (string | false | undefined)[]) =>
  classes.filter(Boolean).join(" ");

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
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
  }, [key, state]);
  return [state, setState] as const;
}

// ===================== CSV & Google Sheets helpers =====================
const isGoogleSheet = (url: string) => url.includes("docs.google.com/spreadsheets");

function normalizeGoogleSheetUrl(url: string): { csvUrl: string; id?: string; gid?: string } {
  try {
    if (!isGoogleSheet(url)) return { csvUrl: url };
    const idMatch = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = url.match(/[?&]gid=(\d+)/);
    const id = idMatch?.[1];
    const gid = gidMatch?.[1];
    const csvUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv` + (gid ? `&gid=${gid}` : "");
    return { csvUrl, id, gid };
  } catch {
    return { csvUrl: url };
  }
}

function detectDelimiterInText(sample: string): string {
  let inQ = false,
    cComma = 0,
    cSemi = 0;
  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ) {
      if (ch === ',') cComma++;
      else if (ch === ';') cSemi++;
      else if (ch === '\n' || ch === '\r') break;
    }
  }
  return cSemi > cComma ? ';' : ',';
}

function parseCSVRobusto(text: string) {
  // Soporta comillas, delimitador auto (, o ;), y saltos de línea dentro de campos
  const delim = detectDelimiterInText(text.slice(0, 1000));
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (!inQ && ch === delim) {
      row.push(cur);
      cur = "";
      continue;
    }
    if (!inQ && ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
      continue;
    }
    if (!inQ && ch === '\r') {
      continue;
    }
    cur += ch;
  }
  // último campo / fila
  row.push(cur);
  rows.push(row);

  // Quitar filas vacías al final
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();

  return rows;
}

function rowsToObjects(rows: string[][]): any[] {
  if (!rows.length) return [];
  // tomar primera fila no vacía como cabecera
  const headIdx = rows.findIndex((r) => r.some((c) => c.trim() !== ""));
  if (headIdx < 0) return [];
  const header = rows[headIdx].map((h) => h.replace(/\r/g, "").trim());
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
  // JSONP sin CORS: interceptamos google.visualization.Query.setResponse
  return await new Promise<any[]>((resolve, reject) => {
    const prevGoogle = (window as any).google;
    const ns: any = ((window as any).google = (window as any).google || {});
    ns.visualization = ns.visualization || {};
    ns.visualization.Query = ns.visualization.Query || {};
    const timeout = setTimeout(() => {
      (window as any).google = prevGoogle; // restaurar
      reject(new Error("Timeout GViz"));
    }, 15000);
    ns.visualization.Query.setResponse = (resp: any) => {
      clearTimeout(timeout);
      (window as any).google = prevGoogle; // restaurar
      try {
        const table = resp?.table;
        const cols = (table?.cols || []).map((c: any, i: number) => c?.label || c?.id || `col${i + 1}`);
        const out: any[] = [];
        for (const row of table?.rows || []) {
          const o: any = {};
          (row?.c || []).forEach((cell: any, idx: number) => {
            o[cols[idx]] = cell?.v ?? "";
          });
          out.push(o);
        }
        resolve(out);
      } catch (e) {
        reject(e);
      }
    };
    const s = document.createElement("script");
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?${gid ? `gid=${gid}&` : ""}tqx=out:json`;
    s.src = url;
    s.onerror = () => {
      (window as any).google = prevGoogle; // restaurar
      reject(new Error("Script GViz error"));
    };
    document.body.appendChild(s);
  });
}

// ===================== App =====================
export default function Page() {
  // Tema
  const [dark, setDark] = useLocalStorage("ui.theme.dark", false);
  const [managerMode] = useLocalStorage<boolean>("ui.managerMode", true);
  useEffect(() => {
    if (dark) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [dark]);

  // Catálogo y estados
  const [catalog, setCatalog] = useLocalStorage<Record<string, CatalogItem>>("catalog", {});
  const [saleLines, setSaleLines] = useLocalStorage<SaleLine[]>("sales", []);
  const [comodatoLines, setComodatoLines] = useLocalStorage<ComodatoLine[]>("comodato", []);
  const [customerName, setCustomerName] = useLocalStorage<string>("customerName", "");

  // Fecha: calcular en cliente para evitar hydration mismatch
  const [todayStr, setTodayStr] = useState("");
  useEffect(() => {
    setTodayStr(
      new Date().toLocaleDateString("es-CL", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    );
  }, []);

  // Parámetros
  const [commissionPct, setCommissionPct] = useLocalStorage<number>("commission", 0.0);
  const [months, setMonths] = useLocalStorage<number>("months", 12);
  const [usePriceListAsCost, setUsePriceListAsCost] = useLocalStorage<boolean>(
    "useListAsCost",
    true
  );
  const [viabilityThreshold] = useLocalStorage<number>("viabilityThreshold", 0.5); // se usa, pero no se muestra
  const [commissionOnNet, setCommissionOnNet] = useLocalStorage<boolean>(
    "commissionOnNet",
    true
  );

  // Datos adicionales
  const [clientRut, setClientRut] = useLocalStorage<string>("client.rut", "");
  const [clientCity, setClientCity] = useLocalStorage<string>("client.city", "");
  const [executive, setExecutive] = useLocalStorage<string>("client.exec", "");
  const [notes, setNotes] = useLocalStorage<string>("notes", "");
  const [logoUrl] = useLocalStorage<string>(
    "pdf.logoUrl",
    "https://www.spartanchemical.com/Static/img/logos/spartan-logo-blue.png"
  );
  const [docNumber, setDocNumber] = useLocalStorage<number>("doc.number", 1);

  const [logoOk, setLogoOk] = useState(true);

  // Catálogo: helper (¡una sola definición!)
  const getItem = (code: string) => catalog[code?.trim()?.toUpperCase()];

  // Permitir cargar catálogo por URL (?catalog_url=...)
  useEffect(() => {
    const u = new URL(location.href);
    let url = u.searchParams.get("catalog_url") || "";
    if (!url && DEFAULT_CATALOG_URL) url = DEFAULT_CATALOG_URL; // fallback para incógnito
    if (!url) return;

    const { csvUrl, id: gId, gid } = normalizeGoogleSheetUrl(url);

    const load = async () => {
      try {
        let rows: any[] = [];
        // 1) Intento directo CSV (si CORS lo permite)
        try {
          const resp = await fetch(csvUrl, { mode: "cors" as RequestMode });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const buf = await resp.arrayBuffer();
          const textRaw = new TextDecoder("utf-8").decode(new Uint8Array(buf));
          const text = textRaw.replace(/^\uFEFF/, ""); // BOM
          const parsed = parseCSVRobusto(text);
          rows = rowsToObjects(parsed);
          if (!rows.length) throw new Error("CSV vacío o mal formado");
        } catch (csvErr) {
          // 2) Fallback JSONP (GViz) sin CORS
          if (gId) {
            const gvizRows = await loadFromGviz(gId, gid);
            rows = gvizRows;
          } else {
            throw csvErr;
          }
        }

        // Mapear a CatalogItem
        const map: Record<string, CatalogItem> = {};
        rows.forEach((r) => {
          const code = String(
            r.code ?? r.CODIGO ?? r.Codigo ?? r.Código ?? r.codigo ?? ""
          )
            .trim()
            .toUpperCase();
          if (!code) return;
          map[code] = {
            code,
            name: String(
              r.name ??
                r.NOMBRE ??
                r.Nombre ??
                r.Descripción ??
                r.descripcion ??
                r.descripcion_producto ??
                ""
            ).trim(),
            price_list:
              Number(
                r.price_list ?? r.price ?? r.PRECIO ?? r.precio ?? r.lista ?? 0
              ) || 0,
            cost:
              r.cost !== undefined && r.cost !== "" ? Number(r.cost) : undefined,
            kilos:
              r.kilos !== undefined && r.kilos !== ""
                ? Number(r.kilos)
                : undefined,
          };
        });

        if (!Object.keys(map).length)
          throw new Error(
            "No se encontraron columnas esperadas (code, name, price_list)"
          );

        setCatalog(map);
      } catch (e: any) {
        console.error("Error cargando catálogo desde URL", e);
        alert(
          "No se pudo cargar el catálogo.\n" +
            "Verifica: 1) el enlace de Google es público (cualquier persona con el enlace), " +
            "2) si es Google Sheets, usa la hoja correcta (gid), 3) intenta de nuevo."
        );
      }
    };

    load();
  }, [setCatalog]);

  // ===================== Carga dinámica de librerías externas =====================
  useEffect(() => {
    const w: any = window as any;
    if (!w.html2pdf) {
      const s = document.createElement("script");
      s.src =
        "https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js";
      s.async = true;
      document.body.appendChild(s);
    }
  }, []);

  useEffect(() => {
    const w: any = window as any;
    if (!w.XLSX) {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      s.async = true;
      document.body.appendChild(s);
    }
  }, []);

  // ===================== Subir Excel (usa window.XLSX) =====================
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target?.result;
      if (!data) return;
      const XLSX = (window as any).XLSX;
      if (!XLSX) {
        alert("Aún cargando la librería XLSX. Vuelve a intentar en 1-2 segundos.");
        return;
      }
      const wb = XLSX.read(data, { type: "binary" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet);
      const map: Record<string, CatalogItem> = {};
      rows.forEach((r) => {
        const code = String(
          r.code ?? r.CODIGO ?? r.Codigo ?? r.Código ?? r.codigo ?? ""
        )
          .trim()
          .toUpperCase();
        if (!code) return;
        map[code] = {
          code,
          name: String(
            r.name ??
              r.NOMBRE ??
              r.Nombre ??
              r.Descripción ??
              r.descripcion ??
              r.descripcion_producto ??
              ""
          ).trim(),
          price_list:
            Number(r.price_list ?? r.price ?? r.PRECIO ?? r.precio ?? r.lista ?? 0) ||
            0,
          cost: r.cost !== undefined && r.cost !== "" ? Number(r.cost) : undefined,
          kilos:
            r.kilos !== undefined && r.kilos !== "" ? Number(r.kilos) : undefined,
        };
      });
      setCatalog(map);
      alert(`Se cargaron ${Object.keys(map).length} ítems del catálogo.`);
    };
    reader.readAsBinaryString(file);
  };

  // ===================== Importar/Exportar JSON =====================
  const importJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const j = JSON.parse(String(reader.result || "{}"));
        if (j.saleLines) setSaleLines(j.saleLines);
        if (j.comodatoLines) setComodatoLines(j.comodatoLines);
        if (j.params) {
          if (typeof j.params.commissionPct === "number")
            setCommissionPct(j.params.commissionPct);
          if (typeof j.params.months === "number") setMonths(j.params.months);
          if (typeof j.params.usePriceListAsCost === "boolean")
            setUsePriceListAsCost(j.params.usePriceListAsCost);
          if (typeof j.params.commissionOnNet === "boolean")
            setCommissionOnNet(j.params.commissionOnNet);
        }
        if (typeof j.customerName === "string") setCustomerName(j.customerName);
        alert("Evaluación importada.");
      } catch (err) {
        alert("JSON inválido.");
      }
    };
    reader.readAsText(file);
  };

  // Exportar SOLO evaluación (JSON)
  const exportScenarioJSON = () => {
    const payload = {
      customerName,
      date: todayStr,
      viable,
      metrics: {
        ventasTot: totals.ventasTot,
        comodatoTotal: totals.comodatoTotalEquipos,
        comodatoMensual: totals.comodatoMensual,
        relComVta: totals.relComVta,
        finalMarginPct: totals.finalMarginPct,
        commissionFinalPct: effectiveCommissionPct,
      },
      params: { commissionPct, months, usePriceListAsCost, commissionOnNet },
      saleLines,
      comodatoLines,
      version: "scenario-v2",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    const safe = (customerName || "cliente").trim().split(" ").join("_");
    a.href = URL.createObjectURL(blob);
    a.download = `evaluacion_${safe}.json`;
    a.click();
  };

  // Exportar SOLO la evaluación a Excel (sin catálogo)
  const exportScenarioXLSX = () => {
    const w: any = window as any;
    const XLSX = w.XLSX;
    if (!XLSX) {
      alert("Aún cargando la librería XLSX. Vuelve a intentar en 1-2 segundos.");
      return;
    }

    // Hoja: Resumen
    const resumen = [
      { Campo: "Cliente", Valor: customerName || "" },
      { Campo: "Fecha", Valor: todayStr || "" },
      { Campo: "Ventas mensual", Valor: totals.ventasTot },
      { Campo: "Comodato total", Valor: totals.comodatoTotalEquipos },
      { Campo: "Comodato mensual", Valor: totals.comodatoMensual },
      { Campo: "% Rel. Comodato/Venta", Valor: totals.relComVta },
      { Campo: "Margen final", Valor: totals.finalMarginPct },
      { Campo: "Viable", Valor: viable ? "Sí" : "No" },
      { Campo: "% Comisión base", Valor: commissionPct },
      { Campo: "% Comisión final", Valor: effectiveCommissionPct },
      { Campo: "Meses contrato", Valor: months },
      { Campo: "Usar lista como costo si falta", Valor: usePriceListAsCost ? "Sí" : "No" },
      {
        Campo: "Comisión sobre venta neta de comodato",
        Valor: commissionOnNet ? "Sí" : "No",
      },
    ];

    // Hoja: Productos (con métricas calculadas por línea)
    const productos = totals.lines.map((r: any, i: number) => ({
      N: i + 1,
      codigo: r.code,
      nombre: r.name,
      kilos_por_pres: r.kilos,
      presentaciones_mes: r.qty,
      precio_venta_kg_bruto: r.sellPrice,
      descuento_pct: r.discountPct || 0,
      precio_venta_kg_efectivo: r.priceSaleKg,
      kilos_mes: r.kilosMes,
      venta: r.venta,
      costo_kg_usado: r.costoKg,
      margen_bruto: r.margenBruto,
      asignacion_comodato: r.asigComodato,
      comision: r.comision,
      margen_final: r.margenFinal,
      margen_final_pct: r.margenFinalPct,
    }));

    // Hoja: Comodatos
    const comodatos = comodatoLines.map((l, i) => ({
      N: i + 1,
      codigo: l.code,
      nombre: l.name,
      costo_mensual_unidad: l.priceList,
      cantidad: l.qty,
      costo_mensual_total: (l.priceList || 0) * (l.qty || 1),
    }));

    const wb = XLSX.utils.book_new();
    const wsResumen = XLSX.utils.json_to_sheet(resumen);
    const wsProds = XLSX.utils.json_to_sheet(productos);
    const wsCom = XLSX.utils.json_to_sheet(comodatos);

    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");
    XLSX.utils.book_append_sheet(wb, wsProds, "Productos");
    XLSX.utils.book_append_sheet(wb, wsCom, "Comodatos");

    const fileName = `Evaluacion_${
      customerName || "Cliente"
    }_${(todayStr || "").replaceAll("/", "-").replace(/\s+/g, "_")}.xlsx`;
    XLSX.writeFile(wb, fileName);
  };

  // ===================== Líneas =====================
  const addSale = () =>
    setSaleLines((s) => [
      ...s,
      {
        code: "",
        name: "",
        priceList: 0,
        kilos: 1,
        qty: 1,
        sellPrice: 0,
        discountPct: 0,
        costOverride: undefined,
      },
    ]);
  const rmSale = (i: number) => setSaleLines((s) => s.filter((_, idx) => idx !== i));
  const dupSale = (i: number) =>
    setSaleLines((s) => {
      const n = [...s];
      n.splice(i + 1, 0, { ...n[i] });
      return n;
    });

  const addCom = () =>
    setComodatoLines((s) => [...s, { code: "", name: "", priceList: 0, qty: 1 }]);
  const rmCom = (i: number) => setComodatoLines((s) => s.filter((_, idx) => idx !== i));

  const onCodeChange = (i: number, code: string) => {
    const it = getItem(code);
    setSaleLines((s) => {
      const n = [...s];
      n[i].code = code.toUpperCase();
      n[i].name = it?.name || "";
      n[i].priceList = it?.price_list || 0;
      n[i].kilos = it?.kilos ?? 1;
      return n;
    });
  };
  const onComCodeChange = (i: number, code: string) => {
    const it = getItem(code);
    setComodatoLines((s) => {
      const n = [...s];
      n[i].code = code.toUpperCase();
      n[i].name = it?.name || "";
      n[i].priceList = it?.price_list || 0; // costo mensual
      return n;
    });
  };

  // ===================== Cálculos (comodato por ventas, comisión sobre ventas) =====================
  const totals = useMemo(() => {
    const lineData = saleLines.map((l) => {
      const it = getItem(l.code);
      const kilosUnit = l.kilos || it?.kilos || 1;
      const kilosMes = (l.qty || 0) * kilosUnit;
      const priceSaleKgBase = l.sellPrice || 0;
      const discount = l.discountPct ? Math.max(0, Math.min(1, l.discountPct)) : 0;
      const priceSaleKg = priceSaleKgBase * (1 - discount);
      const venta = priceSaleKg * kilosMes; // $ por línea
      const costoKg =
        l.costOverride !== undefined && l.costOverride !== null
          ? Number(l.costOverride)
          : it?.cost !== undefined
          ? it.cost
          : usePriceListAsCost
          ? it?.price_list ?? 0
          : 0;
      const margenBruto = (priceSaleKg - costoKg) * kilosMes; // $
      return { ...l, kilosMes, priceSaleKg, venta, costoKg, margenBruto };
    });

    const ventasTot = lineData.reduce((a, r) => a + r.venta, 0);

    // TOTAL de comodato (sumo todos los equipos * cantidad)
    const comodatoTotalEquipos = comodatoLines.reduce(
      (a, l) => a + (l.priceList || 0) * (l.qty || 1),
      0
    );
    // MENSUAL = total / meses
    const comodatoMensual = months > 0 ? comodatoTotalEquipos / months : comodatoTotalEquipos;

    const relComVta = ventasTot > 0 ? comodatoMensual / ventasTot : 0;

    const lines = lineData.map((r) => {
      const asigComodato = ventasTot > 0 ? (r.venta / ventasTot) * comodatoMensual : 0;
      const commissionBase = commissionOnNet ? Math.max(0, r.venta - asigComodato) : r.venta;
      const comision = commissionPct * commissionBase; // % sobre base (bruta o neta de comodato)
      const margenFinal = r.margenBruto - asigComodato - comision;
      const margenFinalPct = r.venta > 0 ? margenFinal / r.venta : 0;
      return { ...r, asigComodato, comision, margenFinal, margenFinalPct };
    });

    const T_total = lines.reduce((a, r) => a + r.margenFinal, 0);
    const U_total = ventasTot > 0 ? T_total / ventasTot : 0;

    return {
      ventasTot,
      comodatoTotalEquipos,
      comodatoMensual,
      relComVta,
      lines,
      finalMarginPct: U_total,
    };
  }, [
    saleLines,
    commissionPct,
    comodatoLines,
    usePriceListAsCost,
    months,
    catalog,
    commissionOnNet,
  ]);

  const viable = totals.finalMarginPct >= viabilityThreshold;

  // Totales derivados
  const commissionTotal = useMemo(
    () => totals.lines.reduce((a: number, r: any) => a + (r.comision || 0), 0),
    [totals.lines]
  );
  const effectiveCommissionPct = useMemo(
    () => (totals.ventasTot > 0 ? commissionTotal / totals.ventasTot : 0),
    [commissionTotal, totals.ventasTot]
  );

  // ===================== Exportar a Word (.doc) =====================
  const escapeHtml = (s: any) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const WORD_LOGO_W_CM = 2.48; // ancho en cm
  const WORD_LOGO_H_CM = 3.14; // alto en cm
  const WORD_FALLBACK_PNG =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/axu/EYAAAAASUVORK5CYII="; // 1x1 transparente

  const buildExecHTML = (logoSrc: string) => {
    const rows = (totals.lines.length
      ? totals.lines
      : [{ code: "—", name: "Sin productos", qty: 0, venta: 0 }])
      .map(
        (r: any) => `
        <tr>
          <td>${escapeHtml(r.code)}</td>
          <td>${escapeHtml(r.name)}</td>
          <td style="text-align:center">${escapeHtml(r.qty ?? 0)}</td>
          <td style="text-align:right">${escapeHtml(moneyCL(r.venta ?? 0))}</td>
        </tr>`
      )
      .join("");

    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" />
      <title>Evaluación Ejecutiva</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#111;}
        .hdr{display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:12px}
        .title{font-size:20px; color:#2B6CFF; font-weight:600}
        .muted{color:#6b7280}
        table{width:100%; border-collapse:collapse;}
        th,td{border:1px solid #d4d4d8; padding:6px}
        thead th{background:#2B6CFF; color:white; text-align:left}
        .kpi{display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin:10px 0 14px}
        .card{border:1px solid #e4e4e7; border-radius:8px; padding:8px}
        .pill{display:inline-block; padding:4px 8px; border-radius:999px; color:white; font-weight:600}
      </style></head><body>
        <div class="hdr">
          <div><img src="${escapeHtml(logoSrc)}" alt="Logo" style="width:${WORD_LOGO_W_CM}cm;height:${WORD_LOGO_H_CM}cm;object-fit:contain" /></div>
          <div style="text-align:right">
            <div class="title">Análisis de Negocio Spartan — Ejecutivo</div>
            <div class="muted">N°: ${escapeHtml(String(docNumber || ""))}</div>
            <div class="muted">Fecha: ${escapeHtml(todayStr)}</div>
          </div>
        </div>
        <div class="kpi">
          <div class="card"><div class="muted" style="font-size:11px">Ventas mensual</div><div style="font-weight:700">${escapeHtml(moneyCL(totals.ventasTot))}</div></div>
          <div class="card"><div class="muted" style="font-size:11px">Comodato mensual</div><div style="font-weight:700">${escapeHtml(moneyCL(totals.comodatoMensual))}</div></div>
          <div class="card"><div class="muted" style="font-size:11px">Estado</div><div><span class="pill" style="background:${viable ? "#059669" : "#dc2626"}">${viable ? "Viable" : "No viable"}</span></div></div>
        </div>
        <table>
          <thead><tr><th>Código</th><th>Descripción</th><th style="text-align:center">Cant.</th><th style="text-align:right">Sub Total</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700"><u>Total</u> General:</td><td style="text-align:right;font-weight:700">${escapeHtml(moneyCL(totals.ventasTot))}</td></tr></tfoot>
        </table>
      </body></html>`;
  };

  const buildDetHTML = (logoSrc: string) => {
    const prodRows = (totals.lines.length
      ? totals.lines
      : [
          {
            code: "—",
            name: "Sin productos",
            kilos: 0,
            qty: 0,
            priceSaleKg: 0,
            venta: 0,
          },
        ])
      .map(
        (r: any) => `
        <tr>
          <td>${escapeHtml(r.code)}</td>
          <td>${escapeHtml(r.name)}</td>
          <td style="text-align:center">${escapeHtml(r.kilos ?? 0)}</td>
          <td style="text-align:right">${escapeHtml(moneyCL(r.priceSaleKg ?? 0))}</td>
          <td style="text-align:center">${escapeHtml(r.qty ?? 0)}</td>
          <td style="text-align:right">${escapeHtml(moneyCL(r.venta ?? 0))}</td>
        </tr>`
      )
      .join("");

    const comRows = (comodatoLines.length
      ? comodatoLines
      : [{ code: "—", name: "Sin equipos", priceList: 0, qty: 0 }])
      .map(
        (l: any) => `
        <tr>
          <td>${escapeHtml(l.code)}</td>
          <td>${escapeHtml(l.name)}</td>
          <td style="text-align:right">${escapeHtml(moneyCL(l.priceList))}</td>
          <td style="text-align:center">${escapeHtml(l.qty)}</td>
          <td style="text-align:right">${escapeHtml(
            moneyCL((l.priceList || 0) * (l.qty || 1))
          )}</td>
        </tr>`
      )
      .join("");

    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8" />
      <title>Evaluación Detallada</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#111;}
        .hdr{display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:12px}
        .title{font-size:20px; color:#2B6CFF; font-weight:600}
        .muted{color:#6b7280}
        table{width:100%; border-collapse:collapse;}
        th,td{border:1px solid #d4d4d8; padding:6px}
        thead th{background:#2B6CFF; color:white; text-align:left}
        .pill{display:inline-block; padding:4px 8px; border-radius:999px; color:white; font-weight:600}
      </style></head><body>
        <div class="hdr">
          <div><img src="${escapeHtml(logoSrc)}" alt="Logo" style="width:${WORD_LOGO_W_CM}cm;height:${WORD_LOGO_H_CM}cm;object-fit:contain" /></div>
          <div style="text-align:right">
            <div class="title">Análisis de Negocio Spartan — Detallado</div>
            <div class="muted">N°: ${escapeHtml(String(docNumber || ""))}</div>
            <div class="muted">Fecha: ${escapeHtml(todayStr)}</div>
          </div>
        </div>
        <div style="margin:6px 0 16px">
          <div><b>Cliente:</b> ${escapeHtml(customerName || '—')}</div>
          <div><b>RUT:</b> ${escapeHtml(clientRut || '—')}</div>
          <div><b>Ciudad:</b> ${escapeHtml(clientCity || '—')}</div>
          <div><b>Ejecutivo:</b> ${escapeHtml(executive || '—')}</div>
        </div>
        <table style="margin-bottom:12px">
          <thead><tr>
            <th>Código</th><th>Descripción</th><th style="text-align:center">Presentación</th>
            <th style="text-align:right">Precio</th><th style="text-align:center">Cantidad</th><th style="text-align:right">Sub Total</th>
          </tr></thead>
          <tbody>${prodRows}</tbody>
          <tfoot><tr><td colspan="5" style="text-align:right;font-weight:700"><u>Total</u> General:</td><td style="text-align:right;font-weight:700">${escapeHtml(moneyCL(totals.ventasTot))}</td></tr></tfoot>
        </table>
        <table style="margin-bottom:12px">
          <thead><tr>
            <th>Código</th><th>Descripción</th><th style="text-align:right">Costo mensual</th><th style="text-align:center">Cant.</th><th style="text-align:right">Total</th>
          </tr></thead>
          <tbody>${comRows}</tbody>
          <tfoot><tr><td colspan="4" style="text-align:right;font-weight:700">Comodato mensual:</td><td style="text-align:right;font-weight:700">${escapeHtml(moneyCL(totals.comodatoMensual))}</td></tr></tfoot>
        </table>
        <div style="margin-top:8px; display:flex; justify-content:space-between; gap:12px">
          <div>
            <span class="pill" style="background:${viable ? "#059669" : "#dc2626"}">${viable ? "Viable" : "No viable"}</span>
            <span class="muted" style="margin-left:8px">Comisión Final: ${escapeHtml(pct(effectiveCommissionPct)).replace('.', ',')}</span>
          </div>
          ${
            notes
              ? `<div style="flex:1; margin-left:12px"><div class="muted" style="margin-bottom:4px">Observaciones</div><div style="border:1px solid #e4e4e7; border-radius:6px; padding:8px; white-space:pre-wrap">${escapeHtml(
                  notes
                )}</div></div>`
              : ''
          }
        </div>
      </body></html>`;
  };

  const exportToWord = (variant: "exec" | "det") => {
    const logoSrc = logoUrl || WORD_FALLBACK_PNG; // usar URL directa; Word la descarga y respeta tamaño en cm
    const html = variant === "exec" ? buildExecHTML(logoSrc) : buildDetHTML(logoSrc);
    const blob = new Blob([html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeDate = (todayStr || "").replaceAll("/", "-").split(" ").join("_");
    a.href = url;
    a.download = `Evaluacion_${customerName || 'Cliente'}_${safeDate}_${
      variant === 'exec' ? 'ejecutiva' : 'detallada'
    }.doc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ===================== PDF (estilo Word) — única definición =====================
  // Usa los mismos templates de Word (buildExecHTML/buildDetHTML) para generar el PDF.
  // Convierte el logo remoto a dataURL para evitar problemas de CORS/"tainted canvas".
  const toDataURL = async (url: string): Promise<string> => {
    try {
      if (!url) return LOGO_FALLBACK_DATA;
      const res = await fetch(url, { mode: 'cors' as RequestMode });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      return dataUrl;
    } catch {
      return LOGO_FALLBACK_DATA;
    }
  };

  const exportToPDF = async (variant: "exec" | "det") => {
    const w: any = window as any;
    if (!w.html2pdf) {
      alert("Cargando librería de PDF... vuelve a intentar en 2-3 segundos.");
      return;
    }
    // 1) Logo inline
    const logoData = await toDataURL(logoUrl);
    // 2) HTML con el mismo formato que Word
    const html = variant === 'exec' ? buildExecHTML(logoData) : buildDetHTML(logoData);
    // 3) Render en un iframe aislado para respetar el <head>/<style> del template
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, { position: 'fixed', left: '-10000px', top: '0', width: '816px', height: '1120px', opacity: '0' });
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();

    // Esperar fuentes e imágenes dentro del iframe
    try { await (doc as any).fonts?.ready; } catch {}
    const imgs = Array.from(doc.images || []);
    await Promise.all(
      imgs.map((im) => new Promise<void>((res) => {
        const el = im as HTMLImageElement;
        if (el.complete) return res();
        el.addEventListener('load', () => res(), { once: true });
        el.addEventListener('error', () => res(), { once: true });
      }))
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    const safeDate = (todayStr || '').replaceAll('/', '-').split(' ').join('_');
    const fileName = `Evaluacion_${customerName || 'Cliente'}_${safeDate}_${variant === 'exec' ? 'ejecutiva' : 'detallada'}.pdf`;

    await w
      .html2pdf()
      .from(doc.body)
      .set({
        margin: 10,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        filename: fileName,
      })
      .save();

    iframe.remove();
  };

  // ===================== Aceptar & Limpiar =====================
  const resetEvaluation = () => {
    setSaleLines([]);
    setComodatoLines([]);
    setCustomerName("");
    setClientRut("");
    setClientCity("");
    setNotes("");
    setDocNumber((n) => Number(n || 0) + 1);
  };
  const onAccept = () => {
    const ok = confirm("¿Aceptar evaluación y limpiar el formulario?");
    if (!ok) return;
    resetEvaluation();
    alert("Evaluación aceptada. Formulario listo para la próxima.");
  };

  // ===================== Checks/dev tests =====================
  useEffect(() => {
    // Pruebas pequeñas para validar funciones clave
    try {
      console.assert(typeof getItem === 'function', 'getItem debe estar definido');
      console.assert(getItem('') === undefined, 'getItem("") debe devolver undefined');
      console.assert(typeof exportToPDF === 'function', 'exportToPDF debe existir (única definición)');
      const sampleExec = buildExecHTML(LOGO_FALLBACK_DATA);
      const sampleDet = buildDetHTML(LOGO_FALLBACK_DATA);
      console.assert(sampleExec.includes('Análisis de Negocio Spartan'), '[TEST] buildExecHTML incluye título');
      console.assert(sampleDet.includes('Análisis de Negocio Spartan — Detallado'), '[TEST] buildDetHTML incluye título detallado');
    } catch {}
  }, [catalog]);

  return (
    <>
      <div className={cn("min-h-screen bg-zinc-50 text-zinc-900", "dark:bg-zinc-950 dark:text-zinc-100")}>
        {/* Topbar – Diagonal Accent */}
    
        <div className="sticky top-0 z-40 relative overflow-hidden">
          <div className="absolute inset-0 bg-[#1f4ed8]" />
          <div className="absolute inset-y-0 right-[-20%] w-[60%] rotate-[-8deg] bg-sky-400/60" />
          <div className="relative mx-auto max-w-7xl px-6 py-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {logoOk ? (
                <img
                  src={logoUrl || ""}
                  alt="Spartan"
                  onError={() => setLogoOk(false)}
                  className="h-10 w-auto md:h-12 lg:h-14 object-contain drop-shadow-sm"
                />
              ) : (
                <img
                  src={LOGO_FALLBACK_DATA}
                  alt="Logo"
                  className="h-10 w-auto md:h-12 lg:h-14 object-contain drop-shadow-sm"
                />
              )}
              <h1 className="text-white uppercase font-semibold tracking-widest text-2xl md:text-3xl">
                Analisis de Negocio Spartan
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-white/20 text-white px-3 py-1 text-xs sm:text-sm">
                Fecha: <b>{todayStr || "—"}</b>
              </span>
              <span className="rounded-full bg-white/20 text-white px-3 py-1 text-xs sm:text-sm">
                Catálogo: <b>{Object.keys(catalog).length}</b>
              </span>
            </div><div className="relative mx-auto max-w-7xl px-6 py-5 flex items-center justify-between">
  <div className="flex items-center gap-3">
    {/* logo + título */}
  </div>

  <div className="flex items-center gap-2">
    {/* badges de fecha / catálogo */}

    {/* ⬅️ Botón Volver al panel */}
    <Link
      href="/"
      className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white ring-1 ring-white/30 hover:bg-white/20"
      aria-label="Volver al panel principal"
    >
      <span className="-ml-0.5">←</span>
      <span>Volver</span>
    </Link>
  </div>
</div>
          </div>
          <div className={cn("h-1 w-full", viable ? "bg-emerald-500/90" : "bg-rose-500/90")} />
        </div>

        {/* Fila cliente (Cliente, RUT, Ciudad, Ejecutivo) */}
        <div className="mx-auto max-w-7xl px-6 pt-3">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="text-zinc-500">Cliente:</label>
            <input
              className="w-64 rounded border px-2 py-1"
              placeholder="Nombre del cliente"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
            <label className="text-zinc-500">RUT:</label>
            <input
              className="w-40 rounded border px-2 py-1"
              placeholder="99.999.999-9"
              value={clientRut}
              onChange={(e) => setClientRut(e.target.value)}
            />
            <label className="text-zinc-500">Ciudad:</label>
            <input
              className="w-40 rounded border px-2 py-1"
              placeholder="Ciudad"
              value={clientCity}
              onChange={(e) => setClientCity(e.target.value)}
            />
            <label className="text-zinc-500">Ejecutivo:</label>
            <input
              className="w-56 rounded border px-2 py-1"
              placeholder="Nombre del ejecutivo"
              value={executive}
              onChange={(e) => setExecutive(e.target.value)}
            />
          </div>
        </div>

        <main className="mx-auto max-w-7xl px-6 py-8">
          {/* Resumen */}
          <div className="mb-6 grid gap-4 md:grid-cols-5">
            <div className="rounded-xl border p-4 border-t-4 border-t-[#2B6CFF]/60">
              <div className="text-xs text-zinc-500">⚖️ Ventas mensual</div>
              <div className="text-xl font-semibold">{money(totals.ventasTot || 0)}</div>
            </div>
            <div className="rounded-xl border p-4 border-t-4 border-t-[#2B6CFF]/60">
              <div className="text-xs text-zinc-500">🏭 Comodato total</div>
              <div className="text-xl font-semibold">{money(totals.comodatoTotalEquipos || 0)}</div>
            </div>
            <div className="rounded-xl border p-4 border-t-4 border-t-[#2B6CFF]/60">
              <div className="text-xs text-zinc-500">📆 Comodato mensual</div>
              <div className="text-xl font-semibold">{money(totals.comodatoMensual || 0)}</div>
            </div>
            <div className="rounded-xl border p-4 border-t-4 border-t-[#2B6CFF]/60">
              <div className="text-xs text-zinc-500">% Rel. Comodato/Venta</div>
              <div className="text-xl font-semibold">{pct(totals.relComVta || 0)}</div>
            </div>
            <div className="rounded-xl border p-4 border-t-4 border-t-[#2B6CFF]/60">
              <div className="text-xs text-zinc-500">Estado</div>
              <div className="mt-1 flex items-center gap-2">
                {/* Ocultamos el % explícito del margen final */}
                <div className="relative group inline-block">
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-sm md:text-base font-semibold shadow-sm",
                      viable ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
                    )}
                  >
                    {viable ? "✅ Viable" : "❌ No viable"}
                  </span>
                  <div className="absolute bottom-full left-1/2 hidden -translate-x-1/2 rounded bg-black px-2 py-1 text-xs text-white group-hover:block">
                    {viable
                      ? "Cumple el umbral de margen."
                      : "Revisa precio de venta, comisión o meses."}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Parámetros */}
          <div className="grid gap-6 md:grid-cols-1">
            <div className="rounded-2xl border bg-white p-6 shadow-sm dark:bg-zinc-900">
              <h2 className="mb-4 text-lg font-semibold text-[#2B6CFF]">⚙️ Parámetros</h2>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                <label className="flex items-center gap-2">
                  <span>% Comisión base</span>
                  <input
                    type="number"
                    step={0.001}
                    value={commissionPct}
                    onChange={(e) => setCommissionPct(Number(e.target.value))}
                    className="w-24 rounded border px-2 py-1 text-right"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span>Meses contrato</span>
                  <input
                    type="number"
                    min={1}
                    value={months}
                    onChange={(e) => setMonths(Math.max(1, Number(e.target.value)))}
                    className="w-24 rounded border px-2 py-1 text-right"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span>% Comisión final</span>
                  <input
                    type="number"
                    step={0.001}
                    value={Number(effectiveCommissionPct.toFixed(3))}
                    readOnly
                    className="w-24 rounded border px-2 py-1 text-right bg-zinc-100 text-zinc-600"
                  />
                </label>
                <label className="hidden inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={managerMode}
                    checked={usePriceListAsCost}
                    onChange={(e) => setUsePriceListAsCost(e.target.checked)}
                  />
                  Usar lista como costo si falta costo
                </label>
                <label className="hidden inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={managerMode}
                    checked={commissionOnNet}
                    onChange={(e) => setCommissionOnNet(e.target.checked)}
                  />
                  Comisión sobre <b>venta neta de comodato</b>
                </label>
                {/* Logo URL oculto en UI; continúa funcionando con el valor persistido en localStorage ('pdf.logoUrl') */}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <label className="text-lg font-semibold text-[#2B6CFF]">📝 Observaciones</label>
            <textarea
              className="mt-1 w-full rounded border px-3 py-2 text-base resize-none"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas para el cliente, condiciones, etc."
            />
          </div>

          {/* Productos */}
          <div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#2B6CFF]">📦 Productos a vender mensual</h2>
              <button
                onClick={addSale}
                className="rounded bg-[#2B6CFF] hover:bg-[#1F5AE6] px-3 py-1 text-xs text-white"
              >
                + Producto
              </button>
            </div>
            {saleLines.length === 0 && (
              <div className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-700">
                FALTAN DATOS: agrega al menos 1 producto, completa <b>Precio venta</b> y <b>Cantidad</b>.
              </div>
            )}

            {/* Datalist para autocompletar códigos */}
            <datalist id="codes">
              {Object.keys(catalog)
                .slice(0, 5000)
                .map((k) => (
                  <option key={k} value={k}>
                    {catalog[k].name}
                  </option>
                ))}
            </datalist>

            <div className="mb-1 grid grid-cols-12 items-center gap-1 text-[10px] text-zinc-600 leading-4">
              <div className="col-span-2 pl-1.5 text-left">Código</div>
              <div className="col-span-4 pl-1.5 text-left">Descripción</div>
              <div className="col-span-1 text-center">UM</div>
              <div className="col-span-2 pr-1.5 text-right">Precio lista</div>
              <div className="col-span-1 pr-1.5 text-right">Cantidad</div>
              <div className="col-span-1 pr-1.5 text-right">Precio venta</div>
              <div className="col-span-1" aria-hidden></div>
            </div>

            {saleLines.map((l, i) => {
              const faltan = (!l.sellPrice && l.sellPrice !== 0) || !l.qty || !l.code;
              const item = getItem(l.code);
              return (
                <div key={i} className="mb-2 rounded-xl border p-2 text-xs">
                  <div className={cn("grid grid-cols-12 items-center gap-1", faltan && "bg-rose-50")}>
                    <input
                      className="col-span-2 rounded border px-1.5 py-0.5"
                      placeholder="Código"
                      value={l.code}
                      onChange={(e) => onCodeChange(i, e.target.value)}
                      list="codes"
                    />
                    <input
                      className="col-span-4 rounded border px-1.5 py-0.5"
                      placeholder="Nombre"
                      value={l.name}
                      onChange={(e) => {
                        const n = [...saleLines];
                        n[i].name = e.target.value;
                        setSaleLines(n);
                      }}
                      readOnly={!managerMode && !!item}
                    />
                    <input
                      type="number"
                      className="col-span-1 rounded border px-1.5 py-0.5 text-right"
                      title="Kg por presentación"
                      value={l.kilos}
                      onChange={(e) => {
                        const n = [...saleLines];
                        n[i].kilos = Number(e.target.value);
                        setSaleLines(n);
                      }}
                      readOnly={!managerMode && !!item}
                    />
                    <input
                      type="number"
                      className="col-span-2 rounded border px-1.5 py-0.5 text-right"
                      title="Lista $/kg"
                      value={l.priceList}
                      onChange={(e) => {
                        const n = [...saleLines];
                        n[i].priceList = Number(e.target.value);
                        setSaleLines(n);
                      }}
                      readOnly={!managerMode && !!item}
                    />
                    <input
                      type="number"
                      className="col-span-1 rounded border px-1.5 py-0.5 text-right"
                      placeholder="Cant."
                      value={l.qty}
                      onChange={(e) => {
                        const n = [...saleLines];
                        n[i].qty = Number(e.target.value);
                        setSaleLines(n);
                      }}
                    />
                    <input
                      type="number"
                      className="col-span-1 rounded border px-1.5 py-0.5 text-right"
                      placeholder="$ venta/kg"
                      value={l.sellPrice}
                      onChange={(e) => {
                        const n = [...saleLines];
                        n[i].sellPrice = Number(e.target.value);
                        setSaleLines(n);
                      }}
                    />
                    {/* NUEVO: % descuento y costo override (ocultos en gerencia) */}
                    <input
                      hidden={managerMode}
                      type="number"
                      step={0.001}
                      className="col-span-1 rounded border px-1.5 py-0.5 text-right"
                      placeholder="% desc"
                      value={l.discountPct ?? 0}
                      onChange={(e) => {
                        const n = [...saleLines];
                        n[i].discountPct = Number(e.target.value);
                        setSaleLines(n);
                      }}
                    />
                    <input
                      type="number"
                      className="col-span-1 rounded border px-1.5 py-0.5 text-right"
                      placeholder="Costo $/kg"
                      hidden={managerMode}
                      value={l.costOverride ?? ""}
                      onChange={(e) => {
                        const n = [...saleLines];
                        const v = e.target.value;
                        n[i].costOverride = v === "" ? undefined : Number(v);
                        setSaleLines(n);
                      }}
                    />
                  </div>
                  {/* Franja de métricas por línea: ocultada por requerimiento */}
                  <div className="mt-1 flex justify-end">
                    <button
                      onClick={() => rmSale(i)}
                      className="rounded bg-red-100 px-2 py-0.5 text-[10px] text-red-700"
                    >
                      × quitar
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Comodatos */}
          <div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#2B6CFF]">🛠️ Equipos en comodato</h2>
              <button
                onClick={addCom}
                className="rounded bg-[#2B6CFF] hover:bg-[#1F5AE6] px-3 py-1 text-xs text-white"
              >
                + Producto
              </button>
            </div>
            {comodatoLines.length === 0 && (
              <div className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-700">
                Agrega equipos y su <b>costo mensual</b> para prorratear el comodato.
              </div>
            )}
            <div className="mb-1 grid grid-cols-12 items-center gap-1 text-[10px] text-zinc-600 leading-4">
              <div className="col-span-2 pl-1.5 text-left">Código</div>
              <div className="col-span-6 pl-1.5 text-left">Descripción</div>
              <div className="col-span-2 pr-1.5 text-right">Precio</div>
              <div className="col-span-1 pr-1.5 text-right">Cantidad</div>
              <div className="col-span-1" aria-hidden></div>
            </div>
            {comodatoLines.map((l, i) => (
              <div key={i} className="mb-1 grid grid-cols-12 items-center gap-1 text-xs">
                <input
                  className="col-span-2 rounded border px-1.5 py-0.5"
                  placeholder="Código"
                  value={l.code}
                  onChange={(e) => onComCodeChange(i, e.target.value)}
                  list="codes"
                />
                <input
                  className="col-span-6 rounded border px-1.5 py-0.5"
                  placeholder="Nombre"
                  value={l.name}
                  readOnly
                />
                <input
                  type="number"
                  className="col-span-2 rounded border px-1.5 py-0.5 text-right"
                  placeholder="$ mensual"
                  value={l.priceList}
                  onChange={(e) => {
                    const n = [...comodatoLines];
                    n[i].priceList = Number(e.target.value);
                    setComodatoLines(n);
                  }}
                />
                <input
                  type="number"
                  className="col-span-1 rounded border px-1.5 py-0.5 text-right"
                  placeholder="Cant."
                  value={l.qty}
                  onChange={(e) => {
                    const n = [...comodatoLines];
                    n[i].qty = Number(e.target.value);
                    setComodatoLines(n);
                  }}
                />
                <button className="col-span-12 mt-1 w-16 rounded bg-red-100 py-0.5 text-center text-[10px] text-red-700" onClick={() => rmCom(i)}>
                  × quitar
                </button>
              </div>
            ))}
          </div>

          {/* Footer de acciones */}
          <div className="mt-8 flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => setDark((v) => !v)}
              className="rounded-xl border px-3 py-1.5 text-xs"
            >
              {dark ? "☀️ Claro" : "🌙 Oscuro"}
            </button>
            <button
              hidden={managerMode}
              onClick={exportScenarioJSON}
              className="rounded border px-3 py-1.5 text-xs border-[#2B6CFF] text-[#2B6CFF] hover:bg-[#2B6CFF] hover:text-white"
              title="Exportar evaluación (JSON)"
            >
              ⤴️ Exportar
            </button>
            <button
              onClick={exportScenarioXLSX}
              className="rounded bg-[#2B6CFF] hover:bg-[#1F5AE6] px-3 py-1.5 text-xs text-white"
              title="Descargar Excel (solo evaluación)"
            >
              ⬇️ XLSX
            </button>
            <button
              onClick={onAccept}
              className="rounded bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs text-white"
              title="Aceptar y limpiar"
            >
              ✔️ Aceptar
            </button>
            <button
              onClick={() => exportToWord('det')}
              className="rounded bg-indigo-600 px-3 py-1.5 text-xs text-white"
              title="Descargar Word detallado"
            >
              ⬇️ Word Detalle
            </button>
            {/* Botones PDF (formato Word) */}
            <button
              onClick={() => exportToPDF('exec')}
              className="rounded bg-indigo-700 hover:bg-indigo-800 px-3 py-1.5 text-xs text-white"
              title="Descargar PDF ejecutivo (formato Word)"
            >
              ⬇️ PDF Ejecutivo
            </button>
            <button
              onClick={() => exportToPDF('det')}
              className="rounded bg-indigo-700 hover:bg-indigo-800 px-3 py-1.5 text-xs text-white"
              title="Descargar PDF detallado (formato Word)"
            >
              ⬇️ PDF Detalle
            </button>

            {/* Import/Select (una sola vez; se eliminaron duplicados) */}
            <label
              hidden={managerMode}
              className="rounded border px-3 py-1.5 text-xs cursor-pointer border-[#2B6CFF] text-[#2B6CFF] hover:bg-[#2B6CFF] hover:text-white"
              title="Importar evaluación (JSON)"
            >
              ⤵️ Importar
              <input type="file" accept="application/json" onChange={importJSON} className="hidden" />
            </label>
            <label
              hidden={managerMode}
              className="rounded border px-3 py-1.5 text-xs cursor-pointer border-[#2B6CFF] text-[#2B6CFF] hover:bg-[#2B6CFF] hover:text-white"
              title="Cargar catálogo (.xlsx)"
            >
              ⬆️ Seleccionar
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          {/* Estilos mínimos para cortes de página (si se quisiera imprimir) */}
          <style>{`
            .pdf-pagebreak { break-before: page; page-break-before: always; }
            .no-break { break-inside: avoid; page-break-inside: avoid; }
            @media print { html, body { background: #ffffff !important; } }
          `}</style>
        </main>
      </div>
    </>
  );
}