import { Link, useNavigate } from 'react-router-dom';
import ethicappLogo from '../assets/logos/ethicapp-logo.svg';

export default function PrivacyPolicyPage() {
    const navigate = useNavigate();
  return (
    <main className="py-5 bg-light min-vh-100">
      <div className="container">
        <div className="mx-auto bg-white shadow-sm rounded-4 p-4 p-md-5" style={{ maxWidth: "860px" }}>
        <header className="mb-4">
            {/* Top bar: volver */}
            <div className="mb-3">
                <button
                type="button"
                className="btn btn-link p-0 text-decoration-none"
                onClick={() => navigate(-1)}
                >
                ← Volver
                </button>
            </div>

            {/* Logo */}
            <div className="text-center mb-3">
                <img
                src={ethicappLogo}
                alt="EthicApp"
                style={{ height: '48px' }}
                />
            </div>

            {/* Título */}
            <div className="text-center">
                <h1 className="mb-2">Política de Privacidad</h1>
                <p className="text-muted mb-0">
                Última actualización: 15 de abril de 2026
                </p>
            </div>
        </header>

          <section className="mb-4">
            <h2 className="h4">1. Responsable del tratamiento</h2>
            <p>
              El responsable del tratamiento de los datos personales es la
              <strong>{' '}
              {import.meta.env.VITE_INSTITUTION_NAME}{' '}</strong>.
            </p>
            <p>
              La plataforma ha sido desarrollada por instituciones colaboradoras y
              se proporciona en estado operativo, siendo{' '}
              {import.meta.env.VITE_INSTITUTION_NAME}
              {' '}la entidad responsable del tratamiento de los datos personales.
            </p>
            <p>
              Para consultas relacionadas con privacidad de datos, puedes contactar a{' '}
              {import.meta.env.VITE_DATAPRIVACY_CONTACT}.
            </p>            
          </section>

          <section className="mb-4">
            <h2 className="h4">2. Datos que se recogen</h2>
            <p>A través de la plataforma se pueden recoger los siguientes datos:</p>
            <ul>
              <li>Nombre y apellidos</li>
              <li>Identificador personal (DNI, RUT u otro equivalente)</li>
              <li>Correo electrónico</li>
              <li>Género, cuando el usuario decida proporcionarlo</li>
              <li>Datos derivados del uso de la plataforma, como respuestas, interacciones y actividad</li>
            </ul>
          </section>

          <section className="mb-4">
            <h2 className="h4">3. Finalidad del tratamiento</h2>
            <p>Los datos personales se tratarán con las siguientes finalidades:</p>
            <ul>
              <li>Gestión de la cuenta de usuario</li>
              <li>Acceso y uso de la plataforma</li>
              <li>Desarrollo de actividades formativas</li>
            </ul>

            <h3 className="h5 mt-4">Uso con fines de investigación</h3>
            <p>
              El uso de los datos con fines de investigación se realizará únicamente
              cuando el usuario haya otorgado su consentimiento explícito mediante
              un proceso de consentimiento informado.
            </p>
            <p>
              Dicho consentimiento se recabará conforme a los protocolos
              institucionales y éticos de la Universidad de Valladolid.
            </p>
            <p>
              Siempre que sea posible, los datos utilizados en investigación serán
              tratados de forma anonimizada o seudonimizada.
            </p>
            <p><b>Importante:</b> El consentimiento para investigación no se recoge a través de esta plataforma,
sino mediante instrumentos específicos aprobados por comités de ética.</p>
          </section>

          <section className="mb-4">
            <h2 className="h4">4. Base legal del tratamiento</h2>
            <ul>
              <li>La ejecución del servicio solicitado por el usuario</li>
              <li>El consentimiento del usuario para finalidades específicas, como investigación</li>
              <li>El cumplimiento de obligaciones legales aplicables</li>
            </ul>
          </section>

          <section className="mb-4">
            <h2 className="h4">5. Conservación de los datos</h2>
            <p>
              Las cuentas de usuario y todos los datos asociados serán eliminados
              periódicamente en las siguientes fechas:
            </p>
            <ul>
              <li>1 de enero</li>
              <li>1 de julio</li>
            </ul>
            <p>
              Sin perjuicio de ello, el sistema mantiene copias de seguridad diarias
              de los datos, con un período máximo de conservación de una semana.
            </p>
          </section>

          <section className="mb-4">
            <h2 className="h4">6. Ubicación y almacenamiento de los datos</h2>
            <p>
              Todos los datos se almacenan en infraestructuras gestionadas por la
              Universidad de Valladolid.
            </p>
          </section>

          <section className="mb-4">
            <h2 className="h4">7. Destinatarios de los datos</h2>
            <p>
              Los datos personales no serán cedidos a terceros, salvo obligación legal
              o cuando sea necesario en el marco de proyectos de investigación
              debidamente autorizados y con el consentimiento previo del usuario.
            </p>
          </section>

          <section className="mb-4">
            <h2 className="h4">8. Derechos del usuario</h2>
            <p>El usuario tiene derecho a:</p>
            <ul>
              <li>Acceder a sus datos personales</li>
              <li>Solicitar la rectificación de datos inexactos</li>
              <li>Solicitar la supresión de sus datos</li>
              <li>Solicitar la limitación del tratamiento</li>
              <li>Oponerse al tratamiento</li>
              <li>Solicitar la portabilidad de los datos</li>
              <li>Retirar el consentimiento en cualquier momento</li>
            </ul>
          </section>

          <section className="mb-4">
            <h2 className="h4">9. Seguridad de los datos</h2>
            <p>
              Se han adoptado medidas técnicas y organizativas adecuadas para
              garantizar la seguridad de los datos personales y evitar su pérdida,
              alteración o acceso no autorizado.
            </p>
          </section>

          <section>
            <h2 className="h4">10. Cambios en la política de privacidad</h2>
            <p>
              Esta política podrá actualizarse en función de cambios normativos o
              técnicos. Se recomienda revisarla periódicamente.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}