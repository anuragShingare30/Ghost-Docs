import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import DocumentEditor from "../../components/document-editor";

type EditorPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditorPage({ params }: EditorPageProps) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const { id } = await params;

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-50">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-16">
        <h1 className="text-3xl font-semibold">Editor</h1>
        <p className="text-neutral-300">Document ID: {id}</p>
        <DocumentEditor documentId={id} />
      </div>
    </main>
  );
}
