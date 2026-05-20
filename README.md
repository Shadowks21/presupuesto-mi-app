# Presupuesto mensual (estatico)

Aplicacion web estatica para registrar categorias, presupuestos mensuales y
gastos manuales. Toda la informacion se guarda en el navegador (localStorage)
y se puede exportar/importar como JSON.

## Desarrollo local

```bash
npm install
npm run dev
```

## Build de produccion

```bash
npm run build
npm run preview
```

## Respaldo de datos

- **Exportar JSON** descarga un archivo con categorias y gastos.
- **Importar JSON** restaura los datos en otro navegador o equipo.

## Despliegue gratis (costo neto 0)

### Cloudflare Pages

1. Conecta este repo a Cloudflare Pages.
2. Configura:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
   - **Root directory:** `/`
3. Despliega desde la rama `main`.

### Limites para mantener costo 0

- Usa subdominio gratuito (evita dominio propio con costo anual).
- Sin backend ni base de datos externa: todo corre en el navegador.
- El almacenamiento es local: si limpias el navegador o cambias de equipo,
  necesitas el export/import.
- Si agregas autenticacion, APIs, o bases de datos, podrias salir del free tier.
