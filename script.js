const menuToggle = document.querySelector(".menu-toggle");
const mainNav = document.querySelector("#main-nav");

if (menuToggle && mainNav) {
  menuToggle.addEventListener("click", () => {
    const isExpanded = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isExpanded));
    menuToggle.setAttribute("aria-label", isExpanded ? "Открыть меню" : "Закрыть меню");
    mainNav.classList.toggle("is-open", !isExpanded);
  });

  mainNav.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLAnchorElement)) return;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "Открыть меню");
    mainNav.classList.remove("is-open");
  });
}

const yearElement = document.querySelector("#year");
if (yearElement) yearElement.textContent = String(new Date().getFullYear());

const projectForm = document.querySelector("#project-form");
const formStatus = document.querySelector("#form-status");
const submitButton = projectForm?.querySelector('button[type="submit"]');

if (projectForm instanceof HTMLFormElement && formStatus instanceof HTMLElement && submitButton instanceof HTMLButtonElement) {
  projectForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!projectForm.reportValidity()) return;

    const formData = new FormData(projectForm);
    formStatus.textContent = "";
    formStatus.classList.remove("is-error");
    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
    try {
      const response = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(formData.get("name")).trim(),
          contact: String(formData.get("contact")).trim(),
          project: String(formData.get("project")).trim()
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Не удалось отправить заявку. Попробуйте позже.");
      projectForm.reset();
      formStatus.textContent = "Заявка отправлена на почту. Мы свяжемся с вами по указанному контакту.";
    } catch (error) {
      formStatus.textContent = error instanceof Error ? error.message : "Не удалось отправить заявку. Попробуйте позже.";
      formStatus.classList.add("is-error");
    } finally {
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
    }
  });
}
