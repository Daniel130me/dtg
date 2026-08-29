import Header from "@/components/prototype/layout/Header";
import Footer from "@/components/prototype/layout/Footer";

export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      {children}
      <Footer />
    </div>
  );
}
