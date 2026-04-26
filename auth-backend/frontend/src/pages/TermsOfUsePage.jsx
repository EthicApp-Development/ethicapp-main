import LegalDocumentPage from '../components/common/LegalDocumentPage';

export default function TermsOfUsePage() {
  return (
    <LegalDocumentPage
      documentKey="terms"
      titleKey="legal.terms.title"
      updatedAtKey="legal.terms.updatedAt"
    />
  );
}
