import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import ethicappLogo from '../assets/logos/ethicapp-logo.svg';

export default function TermsOfUsePage() {
  const navigate = useNavigate();

  return (
    <main className="py-5 bg-light min-vh-100">
      <div className="container">
        <div
          className="mx-auto bg-white shadow-sm rounded-4 p-4 p-md-5"
          style={{ maxWidth: '860px' }}
        >
          <header className="mb-4">
            <div className="mb-3">
              <button
                type="button"
                className="btn btn-link p-0 text-decoration-none"
                onClick={() => navigate(-1)}
              >
                ← Volver
              </button>
            </div>

            <div className="text-center mb-3">
              <img
                src={ethicappLogo}
                alt="EthicApp"
                style={{ height: '48px' }}
              />
            </div>

            <div className="text-center">
              <h1 className="mb-2">Términos de Uso</h1>
              <p className="text-muted mb-0">
                Última actualización: 16 de abril de 2026
              </p>
            </div>
          </header>

          <section className="mb-4">
            <h2 className="h4">1. Objeto</h2>
            <p>
              La plataforma <strong>EthicApp</strong> es una herramienta digital
              destinada al apoyo de actividades formativas y académicas,
              especialmente en el ámbito de la enseñanza de la ética.
            </p>
            <p>
              El acceso y uso de la plataforma implica la aceptación de los
              presentes términos de uso.
            </p>
          </section>

          <section className="mb-4">
            <h2 className="h4">2. Acceso y uso de la plataforma</h2>
            <p>
              El acceso a EthicApp está limitado a usuarios autorizados en el marco
              de actividades académicas o de investigación.
            </p>
            <p>El usuario se compromete a:</p>
            <ul>
              <li>Utilizar la plataforma de forma responsable y conforme a la normativa aplicable</li>
              <li>No utilizar la plataforma con fines ilícitos o no autorizados</li>
              <li>No intentar acceder a cuentas de otros usuarios ni a información restringida</li>
              <li>No interferir en el funcionamiento normal del sistema</li>
            </ul>
          </section>

          <section className="mb-4">
            <h2 className="h4">3. Cuenta de usuario</h2>
            <p>
              Para utilizar la plataforma, el usuario debe registrarse
              proporcionando información veraz y actualizada.
            </p>
            <p>El usuario es responsable de:</p>
            <ul>
              <li>La confidencialidad de sus credenciales de acceso</li>
              <li>Todas las actividades realizadas desde su cuenta</li>
            </ul>
            <p>
              En caso de uso indebido o sospecha de acceso no autorizado, el
              usuario deberá notificarlo a los responsables de la plataforma.
            </p>
          </section>

          <section className="mb-4">
            <h2 className="h4">4. Uso adecuado y contenido generado</h2>
            <p>
              El usuario se compromete a que cualquier contenido generado en la
              plataforma:
            </p>
            <ul>
              <li>Sea respetuoso y acorde al contexto académico</li>
              <li>No vulnere derechos de terceros</li>
              <li>No incluya información ilícita, ofensiva o inapropiada</li>
            </ul>
            <p>
              La plataforma podrá limitar o eliminar contenidos que incumplan
              estas condiciones.
            </p>
          </section>

          <section className="mb-4">
            <h2 className="h4">5. Finalidad académica y de investigación</h2>
            <p>
              EthicApp se utiliza en contextos educativos y puede formar parte de
              actividades docentes o de investigación.
            </p>
            <p>
              El uso de datos con fines de investigación no se rige por estos
              términos de uso y requiere consentimiento informado específico,
              gestionado mediante instrumentos externos.
            </p>
            <p>
              Esto es coherente con lo indicado en la <Link to="/privacy">
              política de privacidad</Link> de la plataforma.
            </p>
          </section>

          <section className="mb-4">
            <h2 className="h4">6. Disponibilidad del servicio</h2>
            <p>
              La plataforma se proporciona en estado operativo y podrá estar sujeta
              a interrupciones, limitaciones técnicas o tareas de mantenimiento.
            </p>
            <p>Los responsables podrán:</p>
            <ul>
              <li>Suspender temporalmente el servicio por mantenimiento</li>
              <li>Modificar funcionalidades</li>
              <li>Interrumpir el acceso en caso de uso indebido</li>
            </ul>
          </section>

          <section className="mb-4">
            <h2 className="h4">7. Seguridad</h2>
            <p>El usuario se compromete a no:</p>
            <ul>
              <li>Introducir código malicioso</li>
              <li>Intentar vulnerar la seguridad del sistema</li>
              <li>Realizar pruebas de penetración sin autorización</li>
            </ul>
            <p>
              Cualquier actividad sospechosa podrá dar lugar a la suspensión de la
              cuenta y a las actuaciones que correspondan conforme a la normativa
              aplicable.
            </p>
          </section>

          <section className="mb-4">
            <h2 className="h4">8. Responsabilidad</h2>
            <p>
              Los responsables de la plataforma no serán responsables de:
            </p>
            <ul>
              <li>Interrupciones del servicio</li>
              <li>Pérdida de datos derivada del uso de la plataforma</li>
              <li>Uso indebido por parte de los usuarios</li>
            </ul>
            <p>
              En todo caso, se adoptarán medidas razonables para garantizar el
              correcto funcionamiento del sistema.
            </p>
          </section>

          <section className="mb-4">
            <h2 className="h4">9. Protección de datos</h2>
            <p>
              El tratamiento de los datos personales se rige por la{' '}
              <strong><Link to="/privacy">
              Política de Privacidad</Link></strong> de la plataforma.
            </p>
            <p>
              Se recomienda al usuario revisar dicho documento para conocer en
              detalle qué datos se recogen, con qué finalidad y cuáles son sus
              derechos.
            </p>
          </section>

          <section className="mb-4">
            <h2 className="h4">10. Modificaciones</h2>
            <p>
              Estos términos podrán ser modificados en cualquier momento para
              adaptarse a cambios normativos, técnicos o funcionales.
            </p>
            <p>
              Las modificaciones serán publicadas en la plataforma y entrarán en
              vigor desde su publicación.
            </p>
          </section>

          <section>
            <h2 className="h4">11. Legislación aplicable</h2>
            <p>
              Estos términos se rigen por la legislación española y, en
              particular, por la normativa aplicable en materia de protección de
              datos personales.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}