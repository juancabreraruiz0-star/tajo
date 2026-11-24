"use client";

import { useActionState } from "react";
import { saveMaterial, type MaterialFormState } from "@/lib/actions/materiales";
import { AVISO_STOCK_NEGATIVO } from "@/lib/domain/stock";
import { LIMITES_MATERIAL, type MaterialField } from "@/lib/domain/validation";
import { Alert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";

const UNIDADES = ["ud", "m²", "m", "m³", "kg", "l", "saco", "caja", "rollo", "h"] as const;

interface MaterialFormProps {
  /** null = alta. */
  id: string | null;
  initial?: Partial<Record<MaterialField, string>>;
  /** El material está ahora mismo en negativo: se avisa y se puede guardar sin tocar el stock. */
  stockNegativo?: boolean;
  /** Mostrar el coste (solo gerencia: la acción y la base de datos lo imponen también). */
  conCoste?: boolean;
}

export function MaterialForm({ id, initial = {}, stockNegativo = false, conCoste = false }: MaterialFormProps) {
  const [state, formAction] = useActionState<MaterialFormState, FormData>(saveMaterial.bind(null, id), {});
  const value = (campo: MaterialField) => state.values?.[campo] ?? initial[campo] ?? "";
  const error = (campo: MaterialField) => state.fieldErrors?.[campo];

  return (
    <Card className="p-4 sm:p-6">
      <form action={formAction} className="space-y-5" noValidate>
        {state.error && <Alert>{state.error}</Alert>}
        {stockNegativo && (
          <Alert tone="warning" title={AVISO_STOCK_NEGATIVO}>
            Puedes guardar otros cambios dejando el stock como está. Cuando repongas o recuentes, escribe el stock real.
          </Alert>
        )}

        <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
          <Input
            label="Nombre"
            name="nombre"
            required
            autoComplete="off"
            maxLength={LIMITES_MATERIAL.nombre}
            placeholder="Azulejo blanco 20×20"
            defaultValue={value("nombre")}
            error={error("nombre")}
          />
          <Input
            label="Unidad"
            name="unidad"
            required
            autoComplete="off"
            list="unidades"
            maxLength={LIMITES_MATERIAL.unidad}
            placeholder="ud"
            defaultValue={value("unidad") || (id ? "" : "ud")}
            error={error("unidad")}
          />
          <datalist id="unidades">
            {UNIDADES.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>

        <div className={conCoste ? "grid gap-5 sm:grid-cols-2" : undefined}>
          <Input
            label="Precio por unidad (€)"
            name="precio"
            required
            inputMode="decimal"
            autoComplete="off"
            placeholder="12,50"
            hint="Sin IVA. Puedes usar coma: 12,50"
            defaultValue={value("precio")}
            error={error("precio")}
          />
          {conCoste && (
            <Input
              label="Coste por unidad (€)"
              name="coste"
              inputMode="decimal"
              autoComplete="off"
              placeholder="8,20"
              hint="Sin IVA. Lo que te cuesta a ti; da el margen de las obras. Vacío: se usa el precio."
              defaultValue={value("coste")}
              error={error("coste")}
            />
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Input
            label="Stock actual"
            name="stock"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            hint={stockNegativo ? "Déjalo igual para no tocarlo o escribe el stock real." : "Admite decimales (2,5)."}
            defaultValue={value("stock")}
            error={error("stock")}
          />
          <Input
            label="Stock mínimo"
            name="stock_minimo"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            hint="Por debajo de esta cantidad se marca en rojo."
            defaultValue={value("stock_minimo")}
            error={error("stock_minimo")}
          />
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-stone-200 pt-5 sm:flex-row sm:justify-end">
          <LinkButton href="/materiales">Cancelar</LinkButton>
          <SubmitButton pendingText="Guardando…">{id ? "Guardar cambios" : "Crear material"}</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
