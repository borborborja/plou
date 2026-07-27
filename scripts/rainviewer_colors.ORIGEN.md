# Origen de `rainviewer_colors.csv`

La tabla de colores es la que **publica RainViewer** para sus mosaicos de radar:
nueve esquemas, con la correspondencia entre reflectividad (dBZ, de −32 a 95) y
el color RGBA de cada píxel, primero la rampa de lluvia y después la de nieve.

Se incorpora al repositorio porque el servidor la necesita para hacer el camino
inverso —de color a dBZ— y así leer la precipitación directamente de las teselas.
De ella se genera `server/src/radar/colorTable.generated.ts` con:

```bash
node scripts/gen-color-table.mjs
```

No es obra de este proyecto. RainViewer permite el uso libre de su API para fines
personales y educativos citando la fuente, que es lo que hace la aplicación en la
pantalla de ajustes y en el README. Si vas a darle un uso comercial o de alto
tráfico, revisa sus condiciones: https://www.rainviewer.com/api.html
