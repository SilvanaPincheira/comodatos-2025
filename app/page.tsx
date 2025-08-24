import Link from "next/link";

export default function HomeMenu() {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Topbar */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[#1f4ed8]" />
        <div className="absolute inset-y-0 right-[-20%] w-[60%] rotate-[-8deg] bg-sky-400/60" />
        <div className="relative mx-auto max-w-7xl px-6 py-10">
          <h1 className="text-white uppercase font-semibold tracking-widest text-2xl md:text-3xl">
            Spartan — Panel Principal
          </h1>
          <p className="mt-2 text-white/80 text-sm max-w-2xl">
            Selecciona un módulo para continuar.
          </p>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-6 sm:grid-cols-2">
          {/* Card: Evaluación de Negocio */}
          <Link
            href="/negocio"
            className="group block rounded-2xl border bg-white p-6 shadow-sm ring-1 ring-black/5 transition hover:shadow-md dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-[#2B6CFF]">Evaluación de Negocio</h2>
              <span className="text-3xl">📈</span>
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Carga catálogo, arma la propuesta, calcula margen, comisión y genera PDF/Word.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 text-[#2B6CFF]">
              <span className="underline underline-offset-4">Ir al módulo</span>
              <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </div>
          </Link>

          {/* Card: Comodatos – Clientes Activos */}
          <Link
            href="/comodatos"
            className="group block rounded-2xl border bg-white p-6 shadow-sm ring-1 ring-black/5 transition hover:shadow-md dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-[#2B6CFF]">Comodatos — Clientes Activos</h2>
              <span className="text-3xl">🧪</span>
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Lee ventas (6m) y comodatos vigentes (24m), calcula relación mensual y simula nuevas instalaciones.
            </p>
            <div className="mt-4 inline-flex items-center gap-2 text-[#2B6CFF]">
              <span className="underline underline-offset-4">Ir al módulo</span>
              <svg className="h-4 w-4 transition group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </div>
          </Link>
        </div>

        {/* Accesos útiles */}
        <div className="mt-10 rounded-2xl border bg-white p-4 shadow-sm dark:bg-zinc-900">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-zinc-600">Accesos rápidos:</span>
            <Link href="/comodatos?admin=1" className="rounded border px-3 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800">
              ⚙️ Configurar fuentes (comodatos)
            </Link>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Consejo: En el módulo de Comodatos usa el botón <b>Cargar hojas</b> o <b>Cargar demo</b>.
          </p>
        </div>
      </main>
    </div>
  );
}
