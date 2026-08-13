# RDZ Deliveries — app de Android para choferes

Cáscara nativa (Capacitor) que carga la app web en vivo y le agrega **GPS en
segundo plano**, que es lo único que un navegador no puede hacer con la
pantalla apagada.

## Cómo funciona

La app **no** trae el sitio dentro del APK: lo carga desde
`https://deliveries-app-rtg2.vercel.app`. Cuando despliegas a Vercel, los
choferes reciben el cambio **sin reinstalar nada**. Solo hay que recompilar el
APK si cambian los permisos, el ícono o el plugin de GPS.

## Rastreo de ubicación

- Solo reporta **entre marcar entrada y marcar salida**. Fuera del turno no se
  registra nada.
- Android muestra una **notificación permanente** mientras comparte. El chofer
  siempre ve que está activo.
- Los choferes fueron informados y lo aceptaron.

## Compilar el APK

Requiere Android Studio (trae su propio JDK) y el SDK de Android.

```bash
cd mobile
npm install

# Ruta del SDK (una sola vez). Usa barras normales: los backslashes
# rompen el archivo .properties de Java.
echo 'sdk.dir=C:/Users/<tu-usuario>/AppData/Local/Android/Sdk' > android/local.properties

npx cap sync android

cd android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug
```

El APK queda en:
`android/app/build/outputs/apk/debug/app-debug.apk`

## Instalar en un teléfono

Por cable, con depuración USB activada:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

O copia el `.apk` al teléfono y ábrelo (hay que permitir "instalar apps
desconocidas" para el explorador de archivos).

### Permisos que hay que conceder

Al marcar entrada por primera vez, Android pide la ubicación. Es importante
elegir **"Permitir todo el tiempo"** — con "Solo mientras se usa la app" el
rastreo se detiene al bloquear la pantalla. Android obliga a hacerlo en dos
pasos: primero se concede el uso normal y luego el sistema ofrece el permiso
de segundo plano.

## Firma (release)

El keystore ya existe en `C:/Users/andre/Documents/rdz-release.keystore`.
Para compilar firmado hay que crear **una sola vez** el archivo
`android/keystore.properties` con la contraseña:

```bash
cd mobile/android
cp keystore.properties.example keystore.properties
# edítalo y reemplaza PON_AQUI_TU_CONTRASEÑA por la real
```

Ese archivo está en `.gitignore` y nunca debe subirse. Si falta, la
compilación de release **no falla**: cae a firma debug (y avisa), pero ese
APK no puede actualizar una instalación existente.

```bash
cd mobile/android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk
```

> ⚠️ Un APK firmado con otra llave **no puede** actualizar al anterior. El APK
> debug que se instaló para probar hay que **desinstalarlo** antes de poner el
> firmado. A partir de ahí, todas las actualizaciones son directas.

## Actualizaciones

**Casi nunca hace falta un APK nuevo.** La cáscara carga el sitio en vivo, así
que pantallas, precios, reportes y rutas llegan solos al desplegar a Vercel.
Solo se recompila cuando cambia algo **nativo**: permisos, ícono, nombre o el
plugin de GPS.

Cuando sí toque publicar uno:

1. Sube `versionCode` (y `versionName`) en `android/app/build.gradle`.
2. Sube el mismo número en `appendUserAgent` de `capacitor.config.ts`.
3. Sube `LATEST_APK_VERSION_CODE` en `src/lib/app-update.ts`.
4. Compila el release y súbelo al bucket público `app` de Supabase, con el
   mismo nombre `RDZ-Deliveries.apk`.
5. Despliega la web.

Los tres números deben coincidir. Con eso, cada chofer con una versión vieja
ve un aviso azul arriba — "Hay una nueva versión de la app · Actualizar" —
que descarga e instala encima, conservando su sesión.
