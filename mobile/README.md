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

## Firma

Hoy se compila en modo **debug**, que se instala bien en teléfonos de la
empresa. Para poder **actualizar** la app sin desinstalarla primero, hace
falta un keystore propio:

```bash
keytool -genkey -v -keystore rdz-release.keystore \
  -alias rdz -keyalg RSA -keysize 2048 -validity 10000
```

Guarda ese archivo y su contraseña fuera del repositorio (el `.gitignore` ya
bloquea `*.keystore` y `keystore.properties`). Con eso se configura
`signingConfigs` en `android/app/build.gradle` para compilar `assembleRelease`.
