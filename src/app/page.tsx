import PaymentDemo from "@/app/payments/payment-demo";
import PostRequestForm from "@/app/requests/post-request-form";
import TemplateManager from "@/app/templates/template-manager";
import DesignerDashboard from "@/app/designers/designer-dashboard";

export default function Home() {
  return (
    <main className="flex flex-col gap-10 pb-12">
      <TemplateManager />
      <PostRequestForm />
      <PaymentDemo />
      <DesignerDashboard />
    </main>
  );
}
