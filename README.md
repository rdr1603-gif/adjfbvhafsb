# PadelCoach Pro

Gestion de club de padel: alumnos, ciclos de mensualidad, calendario de clases,
pagos, recurrencias y reportes. Funciona en el celular, en la tablet y en la
computadora con la misma informacion sincronizada.

## Como corre

```bash
pnpm install
cp .env.example .env.local   # completar DATABASE_URL y SESSION_SECRET
pnpm db:migrate              # crea el schema padelcoach en PostgreSQL
pnpm dev
```

## Variables de entorno

| Variable           | Para que sirve                                                        |
| ------------------ | -------------------------------------------------------------------- |
| `DATABASE_URL`     | Connection string de PostgreSQL (usar el pooler, puerto 6543).        |
| `SESSION_SECRET`   | Clave de 96 caracteres hex que firma la cookie de sesion.             |

Generar el secreto:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

En Vercel hay que definir **las dos** en *Settings -> Environment Variables* para
Production, Preview y Development. Si se cambia `SESSION_SECRET`, todas las
sesiones abiertas se invalidan (cada usuario vuelve a iniciar sesion).

La migracion es idempotente y se puede volver a ejecutar sin riesgo.

## Pruebas

Con la app corriendo en otra terminal (`pnpm dev`) y las variables de entorno
cargadas:

```bash
pnpm typecheck   # TypeScript
pnpm test        # 98 pruebas contra la API y la base reales
pnpm build       # build de produccion
```

`pnpm test` levanta tres suites y limpia los usuarios de prueba al final:

- `scripts/test-sync.js` - API y base: registro, login, push/pull, idempotencia,
  conflictos, borrado logico, aislamiento entre cuentas, validacion.
- `scripts/test-engine.js` - motor cliente: migracion, segundo dispositivo,
  cola offline, coalescencia, conflictos y resolucion manual.
- `scripts/test-app.js` - app en ejecucion: rutas, 401 sin sesion, cookie
  manipulada, validacion del servidor y alta de alumno con clase en calendario.

## Despliegue

El repositorio esta conectado a Vercel con deploy automatico desde `main`.
Despues de `git push`:

1. Configurar `DATABASE_URL` y `SESSION_SECRET` en el proyecto de Vercel.
2. Ejecutar `pnpm db:migrate` una vez contra la base de produccion.

## Como funciona la sincronizacion

- La nube es la fuente de verdad. `localStorage` es la cache local y el respaldo
  sin conexion.
- Cada registro (`alumno`, `ciclo`, `clase`, `recurrencia`, `pago`, `perfil`) tiene
  `updatedAt` y se compara por `(coleccion, id)`.
- Las ediciones se encolan y se agrupan; se suben al volver la conexion, al
  enfocar la ventana o cada 5 segundos.
- Si dos dispositivos editan el mismo registro, el servidor no elige por su
  cuenta: devuelve el conflicto y el usuario decide con *Conservar la mia* o
  *Usar la de la nube*.
- Borrar es logico (`deletedAt`), por lo que una sincronizacion vieja nunca
  resucita un alumno.
- Cada cuenta tiene su propio espacio: el `userId` sale de la cookie firmada y el
  cliente nunca puede pedir datos de otra cuenta.
