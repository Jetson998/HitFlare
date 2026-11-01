import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function NotFound() {
    const { t } = useTranslation();
    return (
        <main className="grid min-h-dvh place-items-center bg-white px-6 text-[#111827] dark:bg-stone-950 dark:text-stone-100">
            <section className="w-full max-w-md">
                <h1 className="text-[18px] font-medium leading-7">{t("notFound.title")}</h1>
                <p className="mt-2 text-[13px] leading-6 text-[#6B7280]">{t("notFound.description")}</p>
                <Link to="/" className="mt-4 inline-block text-[13px] font-medium leading-5 text-[#111827] underline-offset-4 hover:underline dark:text-stone-100">{t("notFound.home")}</Link>
            </section>
        </main>
    );
}
