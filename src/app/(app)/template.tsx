/** Se vuelve a montar en cada navegación: el contenido de la página entra con una aparición suave (CSS). */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-entrada">{children}</div>;
}
