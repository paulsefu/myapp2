type AppLogoProps = {
  className: "brand-mark" | "mini-brand";
};

export default function AppLogo({ className }: AppLogoProps) {
  return (
    <span className={className} aria-hidden="true">
      <img
        src={`${import.meta.env.BASE_URL}wallet-logo.png`}
        alt=""
      />
    </span>
  );
}
