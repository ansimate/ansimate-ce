# Accessibility (A11y) Concept and Implementation Plan

This document describes the current state of accessibility in Ansimate as well as a concrete plan for implementing improvements in accordance with the **WCAG 2.1 AA** guidelines. This plan serves as a working basis for the actual implementation of the frontend adjustments.

---

## 1. Keyboard Operability & Focus Indicators

### Current State & Weaknesses
In the current `style.css`, the default browser outline behavior is disabled in several places (`outline: none;`) without providing accessible alternatives. Affected elements are:
* **Custom Checkboxes:** `.playbook-item input[type="checkbox"]` and `.dialog-checkbox-container input[type="checkbox"]` use `appearance: none` and `outline: none`. As a result, when navigating by keyboard (via `Tab`) it is impossible to tell which checkbox is focused.
* **Navigation Tabs:** `.tab-btn` has `outline: none;` and provides no visual indication of the focus state whatsoever.
* **Buttons and Links:** General buttons and interactive elements in footers have no consistent focus visualization.

### Target State & Implementation Requirements
1. **Enable focus indicators:** The focus state must not be hidden. Instead, a high-contrast focus ring must be defined using `:focus-visible` (so that it appears only during keyboard navigation, not on mouse clicks).
2. **Add CSS rules:**
   ```css
   /* Global focus ring for keyboard control */
   :focus-visible {
       outline: 3px solid var(--md-sys-color-primary, #00ADB5);
       outline-offset: 3px;
   }
   
   /* Specific handling for custom checkboxes */
   .playbook-item input[type="checkbox"]:focus-visible,
   .dialog-checkbox-container input[type="checkbox"]:focus-visible,
   .checkbox-container input[type="checkbox"]:focus-visible {
       outline: 2px solid var(--md-sys-color-primary, #00ADB5);
       outline-offset: 2px;
       border-color: var(--md-sys-color-primary, #00ADB5);
   }
   
   /* Focus behavior for navigation tabs */
   .tab-btn:focus-visible {
       outline: 2px solid var(--md-sys-color-primary, #00ADB5);
       outline-offset: -2px; /* Inside the tab */
       border-radius: 8px 8px 0 0;
   }
   ```

---

## 2. Color Contrasts & Theming Guidelines

### Current State (Dark Theme)
The default color palette in the dark theme is based on Material Design 3 (M3) and exhibits predominantly excellent contrasts that are well above the required WCAG 2.1 AA ratios (at least 4.5:1 for text, 3.0:1 for graphics/UI controls):
* **Normal text:** `#E6E1E5` on `#141218` (contrast **16.2:1**) – *Passed successfully*
* **Primary interaction elements:** `#D0BCFF` on `#0F0D13` (contrast **11.2:1**) – *Passed successfully*
* **Borderline values:** Border lines (`--md-sys-color-outline` with `#938F99` on `#141218`) have a contrast ratio of **4.7:1**, which is fine for purely decorative elements but, when used as an active divider, should not be darkened any further.

### Requirements for Developing the Light Theme
When implementing the upcoming light theme, the following color pairings must be observed in order to avoid contrast problems in light mode:
1. **Background and text:** The contrast between the default text color (e.g., anthracite `#212121` or `#1C1B1F`) and a light background (e.g., `#FFFFFF` or `#F8F9FA`) must be at least **4.5:1**.
2. **Primary color:** If the light turquoise (`#00ADB5`) or light violet (`#D0BCFF`) is used in light mode, it must be ensured that text on top of it (e.g., on buttons) is dark enough, or the primary color for light mode is adjusted to a darker violet (e.g., `#6750A4`) or darker petrol (e.g., `#007A80`).
3. **UI control borders:** Custom checkboxes must have a sufficiently dark border even in the unselected state (contrast value of at least **3.0:1** against the background).

---

## 3. Screen Readers & ARIA Attributes

### Current State & Weaknesses
All modal overlays (login, registration, profile, credentials) are implemented as simple `div` containers that are shown or hidden on activation via the `.hidden` class.
* **Problem 1:** For screen readers, these containers are not declared as dialogs. A visually impaired user has no way of knowing that a modal window has opened.
* **Problem 2:** ARIA roles and attributes for semantic description are missing.
* **Problem 3:** There is no **focus trapping** in the JavaScript. If the user presses `Tab` while a modal is open, the focus jumps to elements on the main page in the background (e.g., the navigation or the playbook selection).

### Target State & Implementation Requirements

#### A. HTML Structure of the Modals
Every modal overlay (`.dialog-overlay`) and every modal card (`.dialog-card`) in the file `frontend/src/index.html` should be extended with ARIA attributes as follows:
```html
<!-- Example for the login modal -->
<div id="login-dialog" class="dialog-overlay hidden" aria-hidden="true">
    <div class="dialog-card auth-modal" 
         role="dialog" 
         aria-modal="true" 
         aria-labelledby="login-title" 
         aria-describedby="login-desc">
        
        <div class="dialog-header">
            <h2 id="login-title">Sign in</h2>
        </div>
        <div class="dialog-body">
            <p id="login-desc" class="sr-only">Sign in to access your devices and playbooks.</p>
            <!-- Form fields -->
        </div>
    </div>
</div>
```
* **Explanation:**
  * `role="dialog"`: Declares the element as a dialog window.
  * `aria-modal="true"`: Informs assistive technologies that interactions outside this window are blocked.
  * `aria-labelledby`: References the heading of the modal.
  * `aria-describedby`: References a short description (can be visually hidden using `.sr-only`).
  * `aria-hidden="true"`: Prevents screen readers from announcing the modal before it is opened.

#### B. JavaScript Modal Control (Focus Management)
In `frontend/src/app.js`, opening and closing the modals must be extended with accessibility logic:

1. **Mirror ARIA state:**
   * On opening: `dialogEl.removeAttribute('aria-hidden')` or `dialogEl.setAttribute('aria-hidden', 'false')`.
   * On closing: `dialogEl.setAttribute('aria-hidden', 'true')`.
2. **Remember previous focus:** Before opening a modal, store the currently focused element (`document.activeElement`) and return focus there when closing.
3. **Implement a focus trap:**
   While a modal is active, focus must not escape the window.
   ```javascript
   function trapFocus(event, modalEl) {
       if (event.key !== 'Tab') return;
       
       const focusableElements = modalEl.querySelectorAll(
           'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex="0"], [contenteditable]'
       );
       
       const firstElement = focusableElements[0];
       const lastElement = focusableElements[focusableElements.length - 1];
       
       if (event.shiftKey) { // Shift + Tab
           if (document.activeElement === firstElement) {
               lastElement.focus();
               event.preventDefault();
           }
       } else { // Tab
           if (document.activeElement === lastElement) {
               firstElement.focus();
               event.preventDefault();
           }
       }
   }
   ```
   This listener must be bound to `keydown` when a modal opens and removed again when it closes.

---

## 4. Concrete Implementation Steps (Follow-up Tasks)

The following three work packages are recommended for the implementation:

1. **Task 1: CSS Focus Indicators & Contrast Verification**
   * Remove destructive `outline: none` without a visual replacement.
   * Implement `:focus-visible` styles for buttons, links, tabs, and all custom checkboxes.
2. **Task 2: Modal ARIA Semantics & Focus Trapping**
   * Add the attributes (`role="dialog"`, `aria-modal="true"`, etc.) to `index.html`.
   * Add the JS logic in `app.js` to toggle `aria-hidden` and to implement the focus-trapping algorithm.
3. **Task 3: Semantic Screen Reader Aids**
   * Add an `.sr-only` CSS class (visually hidden) for screen-reader-exclusive helper text (e.g., password requirements, additional captcha information).
   * Assign `alt` attributes to all custom playbook images/icons.
