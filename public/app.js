(function (exports) {
    "use strict";

    let fetch = exports.fetch || require("fetch");
    let Foo = {};
    exports.Foo = Foo;

    Foo.submit = evify(async function (ev) {
        console.log("ev:", ev);

        let email = $('[type="email"]', ev.target).value;
        let resp = await fetch("/api/public/payment-addresses", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(
                {
                    email: email,
                },
                null,
                2
            ),
        });
        let json = await resp.json();
        console.log("response:", json);

        /*
        form data-id="payment-address" onsubmit="Foo.submit()" hidden>
                    <img data-id="qr-src" />
                    <br />
                    <span data-tpl="payment-address">X</span>
        */

        $(`[data-id="qr-src"]`).src = json.qr.src;
        $(`[data-tpl="payment-address"]`).innerText = json.addr;
        $(`[data-tpl="payment-amount"]`).innerText = json.amount;
        $$("form").forEach(function ($form) {
            $form.hidden = true;
        });
        $(`[data-id="payment-address"]`).hidden = false;
    });

    function init() {
        $(
            '[data-tpl="base-url"]'
        ).innerText = `${location.protocol}//${location.hostname}`;
    }
    init();

    function evify(fn) {
        return async function () {
            let ev = window.event;
            ev.preventDefault();
            ev.stopPropagation();
            await fn(ev).catch(function (err) {
                console.error("Fail:");
                console.error(err);
                exports.alert(err);
            });
        };
    }

    function $(sel, el) {
        return (el || document).querySelector(sel);
    }

    function $$(sel, el) {
        return (el || document).querySelectorAll(sel);
    }
})(("undefined" === typeof module && window) || exports);
