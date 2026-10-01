"""Convert Newgarden's FAQ pseudo-HTML into Shopify rich-text JSON."""
from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from typing import Any


class _FAQHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[dict[str, Any]] = []
        self.body: list[str] = []
        self.heading: tuple[str, list[str]] | None = None

    @staticmethod
    def _text_node(text: str) -> dict[str, str]:
        return {"type": "text", "value": text}

    def _flush_body(self) -> None:
        text = "".join(self.body).replace("\r\n", "\n").replace("\r", "\n")
        self.body.clear()
        for part in re.split(r"\n\s*\n", text):
            part = re.sub(r"\s*\n\s*", " ", part).strip()
            if part:
                self.blocks.append({"type": "paragraph", "children": [self._text_node(part)]})

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("h2", "h3"):
            if self.heading:
                raise ValueError("No se permiten encabezados FAQ anidados.")
            self._flush_body()
            self.heading = (tag, [])
        elif tag == "br":
            (self.heading[1] if self.heading else self.body).append("\n")
        else:
            raise ValueError(f"Etiqueta FAQ no admitida: <{tag}>. Solo se admiten h2, h3 y br.")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("h2", "h3"):
            if not self.heading or self.heading[0] != tag:
                raise ValueError(f"Cierre FAQ inesperado: </{tag}>.")
            text = re.sub(r"\s+", " ", "".join(self.heading[1])).strip()
            if text:
                # Match the rich_text_field structure already stored by this
                # shop: heading nodes are direct children of the root.
                self.blocks.append({
                    "type": "heading", "level": int(tag[1]),
                    "children": [self._text_node(text)],
                })
            self.heading = None
        elif tag == "br":
            return
        else:
            raise ValueError(f"Cierre FAQ no admitido: </{tag}>.")

    def handle_data(self, data: str) -> None:
        (self.heading[1] if self.heading else self.body).append(data)


def parse_faq(value: str) -> str:
    """Return compact Shopify rich-text JSON from pseudo-HTML or rich-text JSON.

    Newgarden input uses h2/h3 as semantic heading markers; untagged content
    becomes paragraph blocks. Existing Shopify rich-text JSON is accepted as-is
    after basic root-shape validation, which makes rollback and re-import safe.
    """
    raw = value.strip()
    if not raw:
        raise ValueError("FAQ vacío.")
    if raw.startswith("{"):
        try:
            document = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError("FAQ JSON inválido.") from exc
        if not isinstance(document, dict) or document.get("type") != "root" or not isinstance(document.get("children"), list):
            raise ValueError('El JSON FAQ debe tener type="root" y una lista children.')
        return json.dumps(document, ensure_ascii=False, separators=(",", ":"))

    parser = _FAQHTMLParser()
    try:
        parser.feed(raw)
        parser.close()
    except ValueError:
        raise
    if parser.heading:
        raise ValueError(f"Falta cerrar <{parser.heading[0]}> en el FAQ.")
    parser._flush_body()
    return json.dumps({"type": "root", "children": parser.blocks}, ensure_ascii=False, separators=(",", ":"))
