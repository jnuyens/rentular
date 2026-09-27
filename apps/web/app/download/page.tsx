import Link from "next/link";
import Image from "next/image";
import { Smartphone, Download, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Rentular voor Android",
  description: "Download de Rentular Android-app.",
};

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-muted/30">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Link href="/" className="mb-8 inline-flex items-center gap-2">
          <Image src="/rentular.png" alt="Rentular" width={40} height={40} />
          <span className="text-xl font-bold">Rentular</span>
        </Link>

        <div className="rounded-2xl border bg-background p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
              <Smartphone className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Rentular voor Android</h1>
              <p className="text-sm text-muted-foreground">
                De volledige app op je telefoon. Eenmaal aanmelden, blijf je ingelogd.
              </p>
            </div>
          </div>

          <a
            href="/rentular.apk"
            download
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700 sm:w-auto"
          >
            <Download className="h-5 w-5" />
            Download de app (.apk)
          </a>

          <div className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Installeren
            </h2>
            <ol className="mt-3 space-y-3 text-sm">
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                  1
                </span>
                <span>Tik hierboven op <strong>Download de app</strong> op je Android-telefoon.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                  2
                </span>
                <span>
                  Open het gedownloade bestand. Sta indien gevraagd toe dat je browser
                  apps van &quot;onbekende bronnen&quot; mag installeren.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold">
                  3
                </span>
                <span>Open Rentular en meld je eenmalig aan. Je blijft daarna ingelogd.</span>
              </li>
            </ol>
          </div>

          <div className="mt-8 flex items-start gap-2 rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Werkt op Android 5.0 en nieuwer. De app opent de beveiligde website
              (www.rentular.com); je gegevens blijven op je eigen account.
            </span>
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/" className="underline">
            Terug naar de website
          </Link>
        </p>
      </div>
    </div>
  );
}
