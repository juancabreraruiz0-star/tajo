import { HelmetIcon } from "@/components/icons";
import { LinkButton } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <HelmetIcon className="size-7" />
      </div>
      <h1 className="text-xl font-semibold text-stone-900">No encontramos esta página</h1>
      <p className="mt-2 max-w-sm text-sm text-stone-600">
        Puede que el enlace esté mal escrito o que el registro se haya borrado.
      </p>
      <LinkButton href="/" variant="primary" className="mt-6">
        Volver al panel
      </LinkButton>
    </main>
  );
}
