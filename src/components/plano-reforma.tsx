import { cn } from "./ui/cn";

/**
 * Plano de una vivienda con el baño marcado en ámbar y sus cotas: la ilustración del login. SVG propio y
 * decorativo, pensado para ir sobre fondo slate-900.
 */
export function PlanoReforma({ className }: { className?: string }) {
  const muro = "#cbd5e1"; // slate-300
  const linea = "#94a3b8"; // slate-400
  const ambar = "#f1a843"; // amber-400

  return (
    <svg
      viewBox="0 0 440 296"
      aria-hidden="true"
      focusable="false"
      className={cn("h-auto w-full", className)}
      fill="none"
      strokeLinecap="round"
    >
      {/* Estancia en obra: el baño */}
      <rect x="236" y="48" width="156" height="98" fill={ambar} fillOpacity="0.1" />
      <rect
        x="244"
        y="56"
        width="140"
        height="82"
        rx="3"
        stroke={ambar}
        strokeOpacity="0.8"
        strokeDasharray="5 5"
        className="motion-safe:animate-[trazo_24s_linear_infinite]"
      />

      {/* Muros exteriores (con huecos de ventana arriba y abajo) */}
      <g stroke={muro} strokeOpacity="0.7" strokeWidth="7" strokeLinecap="square">
        <path d="M48 48h70M168 48h146M354 48h46v232H260M200 280H48V48" />
      </g>
      {/* Ventanas: doble línea fina en los huecos */}
      <g stroke={muro} strokeOpacity="0.55" strokeWidth="1.5">
        <path d="M118 45.5h50M118 50.5h50M314 45.5h40M314 50.5h40M200 277.5h60M200 282.5h60" />
      </g>

      {/* Tabiques */}
      <g stroke={muro} strokeOpacity="0.6" strokeWidth="4" strokeLinecap="square">
        <path d="M232 48v58M232 136v14M232 150h-62M130 150H48M232 150h40M312 150h88M232 150v40M232 230v50" />
      </g>

      {/* Puertas: hoja y arco de apertura */}
      <g stroke={linea} strokeOpacity="0.7" strokeWidth="1.25">
        <path d="M232 106l26 -16" />
        <path d="M258 90a30 30 0 0 1 -26 46" strokeDasharray="3 4" />
        <path d="M130 150l0 -40" />
        <path d="M130 110a40 40 0 0 1 40 40" strokeDasharray="3 4" />
        <path d="M272 150l0 32" />
        <path d="M272 182a40 40 0 0 0 40 -32" strokeDasharray="3 4" />
        <path d="M232 190l-36 0" />
        <path d="M196 190a40 40 0 0 0 36 40" strokeDasharray="3 4" />
      </g>

      {/* Mobiliario: plato de ducha, lavabo, inodoro, encimera de cocina y sofá */}
      <g stroke={ambar} strokeOpacity="0.75" strokeWidth="1.5">
        <rect x="336" y="64" width="40" height="56" rx="3" />
        <path d="M336 64l40 56M376 64l-40 56" strokeOpacity="0.35" />
        <rect x="256" y="60" width="34" height="20" rx="8" />
        <rect x="302" y="58" width="18" height="24" rx="9" />
      </g>
      <g stroke={linea} strokeOpacity="0.55" strokeWidth="1.5">
        <path d="M58 58h56v18H76v54H58z" />
        <circle cx="70" cy="68" r="5" />
        <circle cx="96" cy="68" r="5" />
        <rect x="70" y="210" width="96" height="34" rx="6" />
        <path d="M78 210v-8h80v8" />
        <rect x="292" y="196" width="70" height="46" rx="4" />
      </g>

      {/* Cotas */}
      <g stroke={linea} strokeOpacity="0.6" strokeWidth="1">
        <path d="M48 22h352M48 16v12M400 16v12" />
        <path d="M22 48v232M16 48h12M16 280h12" />
        <path d="M420 48v102M414 48h12M414 150h12" stroke={ambar} strokeOpacity="0.8" />
      </g>
      <g fill={linea} fillOpacity="0.85" fontSize="11" fontWeight="500" letterSpacing="0.04em">
        <text x="224" y="17" textAnchor="middle">
          9,60 m
        </text>
        <text x="14" y="164" textAnchor="middle" transform="rotate(-90 14 164)">
          6,20 m
        </text>
      </g>
      <text
        x="434"
        y="99"
        textAnchor="middle"
        transform="rotate(90 434 99)"
        fill={ambar}
        fontSize="11"
        fontWeight="600"
        letterSpacing="0.04em"
      >
        2,50 m
      </text>

      {/* Rótulo de la estancia */}
      <g>
        <rect x="272" y="104" width="58" height="22" rx="11" fill={ambar} />
        <text x="301" y="119" textAnchor="middle" fill="#12202f" fontSize="11" fontWeight="700">
          Baño
        </text>
      </g>
    </svg>
  );
}
